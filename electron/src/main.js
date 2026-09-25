'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

let mainWindow = null;
let core = null;
let coreReady = false;
let nextId = 1;
const pending = new Map();
let shuttingDown = false;

function logLine(line) {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'jarvis-core.log'), `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch (_) {}
}

function backendPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'jarvis_core.exe');
  }
  const override = process.env.JARVIS_CORE_EXE;
  return override || path.join(__dirname, '..', 'backend-dist', 'jarvis_core.exe');
}

function notify(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function rejectAll(message) {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(message));
  }
  pending.clear();
}

function startCore() {
  if (core && !core.killed) return;
  const exe = backendPath();
  logLine(`Starting core: ${exe}`);
  if (!fs.existsSync(exe)) {
    const err = `JARVIS core missing: ${exe}`;
    logLine(err);
    notify('jarvis:core-status', { ready: false, error: err });
    return;
  }
  coreReady = false;
  core = spawn(exe, [], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  });
  const rl = readline.createInterface({ input: core.stdout });
  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.event === 'bridge.ready') {
        coreReady = true;
        notify('jarvis:core-status', { ready: true, version: msg.version, pid: msg.pid });
        return;
      }
      if (msg.id != null && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.ok) entry.resolve(msg.result);
        else {
          const err = new Error(msg.error || 'JARVIS core request failed');
          err.coreType = msg.type;
          err.coreTrace = msg.trace;
          entry.reject(err);
        }
      }
    } catch (err) {
      logLine(`Invalid core JSON: ${line}`);
    }
  });
  core.stderr.on('data', (data) => logLine(`STDERR ${String(data).trim()}`));
  core.on('error', (err) => {
    logLine(`Core process error: ${err.stack || err}`);
    notify('jarvis:core-status', { ready: false, error: err.message });
  });
  core.on('exit', (code, signal) => {
    logLine(`Core exited code=${code} signal=${signal}`);
    coreReady = false;
    rejectAll(`JARVIS core stopped (code ${code ?? 'n/a'})`);
    if (!shuttingDown) notify('jarvis:core-status', { ready: false, error: `Core stopped (${code ?? 'n/a'})` });
    core = null;
  });
}

function coreRequest(op, payload = {}, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    if (!core || core.killed || !core.stdin.writable) {
      return reject(new Error('JARVIS core is not running'));
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`JARVIS core timed out while running ${op}`));
      }
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, op });
    core.stdin.write(`${JSON.stringify({ id, op, payload })}\n`, 'utf8', (err) => {
      if (err && pending.has(id)) {
        const entry = pending.get(id);
        pending.delete(id);
        clearTimeout(entry.timer);
        reject(err);
      }
    });
  });
}


async function runCiSmoke() {
  return new Promise((resolve) => {
    const deadline = setTimeout(() => resolve(91), 300000);
    const check = setInterval(async () => {
      if (!coreReady) return;
      clearInterval(check);
      try {
        const boot = await coreRequest('boot', {}, 180000);
        if (!boot || !boot.ready) throw new Error('core boot did not report ready');
        const self = await coreRequest('self_test', {}, 300000);
        if (!self || !self.ok) throw new Error('core self-test failed');
        await coreRequest('diagnostics', {}, 180000);
        await coreRequest('shutdown', {}, 15000).catch(() => {});
        clearTimeout(deadline);
        resolve(0);
      } catch (err) {
        logLine(`CI smoke failed: ${err.stack || err}`);
        clearTimeout(deadline);
        resolve(92);
      }
    }, 250);
  });
}

function createWindow() {
  nativeTheme.themeSource = 'dark';
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#071015',
    title: 'JARVIS GM',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('jarvis:request', async (_event, op, payload) => {
  try {
    const result = await coreRequest(op, payload || {}, op === 'command' || op === 'invoke' || op === 'self_test' ? 300000 : 180000);
    return { ok: true, result };
  } catch (err) {
    logLine(`IPC ${op} failed: ${err.stack || err}`);
    return { ok: false, error: err.message, type: err.coreType || err.name, trace: err.coreTrace || '' };
  }
});

ipcMain.handle('jarvis:pick-save', async (_event, options) => {
  const out = await dialog.showSaveDialog(mainWindow, options || {});
  return out.canceled ? null : out.filePath;
});

ipcMain.handle('jarvis:pick-open', async (_event, options) => {
  const out = await dialog.showOpenDialog(mainWindow, options || {});
  return out.canceled ? [] : out.filePaths;
});

ipcMain.handle('jarvis:open-user-data', async () => {
  const target = app.getPath('userData');
  await shell.openPath(target);
  return target;
});


ipcMain.handle('jarvis:export-bundled', async (_event, kind) => {
  const table = {
    source: { rel: path.join('owner', 'JARVIS_GM_OWNER_SOURCE_1.7.0rc1.zip'), name: 'JARVIS_GM_OWNER_SOURCE_1.7.0rc1.zip', filters: [{ name: 'ZIP', extensions: ['zip'] }] },
    android: { rel: path.join('mobile', 'JARVIS_GM_Companion_debug.apk'), name: 'JARVIS_GM_Companion_debug.apk', filters: [{ name: 'Android APK', extensions: ['apk'] }] }
  };
  const item = table[kind];
  if (!item) throw new Error('Unknown bundled export');
  const src = path.join(process.resourcesPath, item.rel);
  if (!fs.existsSync(src)) throw new Error(`Bundled file is not present: ${item.name}`);
  const out = await dialog.showSaveDialog(mainWindow, { title: `Exportar ${item.name}`, defaultPath: item.name, filters: item.filters });
  if (out.canceled || !out.filePath) return null;
  fs.copyFileSync(src, out.filePath);
  return out.filePath;
});

ipcMain.handle('jarvis:restart-core', async () => {
  try {
    if (core && core.stdin.writable) {
      await coreRequest('shutdown', {}, 10000).catch(() => {});
    }
  } finally {
    if (core && !core.killed) core.kill();
    core = null;
    startCore();
  }
  return true;
});

app.whenReady().then(async () => {
  const ciSmoke = process.argv.includes('--ci-smoke');
  if (!ciSmoke) createWindow();
  startCore();
  if (ciSmoke) {
    const code = await runCiSmoke();
    shuttingDown = true;
    try { if (core && !core.killed) core.kill(); } catch (_) {}
    app.exit(code);
    return;
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (event) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (core && core.stdin && core.stdin.writable) {
    event.preventDefault();
    coreRequest('shutdown', {}, 6000).catch(() => {}).finally(() => {
      try { if (core && !core.killed) core.kill(); } catch (_) {}
      app.quit();
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});