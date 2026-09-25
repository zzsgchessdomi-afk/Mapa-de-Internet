const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let win = null;
let backend = null;
let backendReady = false;
let nextId = 1;
let buffer = '';
const pending = new Map();
let shuttingDown = false;

function backendPath() {
  if (process.env.JARVIS_BACKEND_EXE) return process.env.JARVIS_BACKEND_EXE;
  return path.join(process.resourcesPath, 'backend', 'jarvis_bridge.exe');
}

function logFile() {
  return path.join(app.getPath('userData'), 'electron-backend.log');
}

function appendLog(line) {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    fs.appendFileSync(logFile(), `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch (_) {}
}

function rejectAll(message) {
  for (const [, item] of pending) item.reject(new Error(message));
  pending.clear();
}

function handleBackendLine(line) {
  if (!line.trim()) return;
  appendLog(`OUT ${line}`);
  let msg;
  try { msg = JSON.parse(line); }
  catch (_) { return; }
  if (msg.event === 'ready') {
    backendReady = true;
    if (win && !win.isDestroyed()) win.webContents.send('jarvis:event', msg);
    return;
  }
  if (msg.event === 'fatal') {
    backendReady = false;
    if (win && !win.isDestroyed()) win.webContents.send('jarvis:event', msg);
    return;
  }
  if (msg.event) {
    if (win && !win.isDestroyed()) win.webContents.send('jarvis:event', msg);
    return;
  }
  if (msg.id != null && pending.has(msg.id)) {
    const item = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) item.resolve(msg.result);
    else item.reject(Object.assign(new Error(msg.error || 'JARVIS backend error'), { detail: msg }));
  }
}

function startBackend() {
  const exe = backendPath();
  if (!fs.existsSync(exe)) throw new Error(`No se encontró el núcleo de JARVIS: ${exe}`);
  appendLog(`START ${exe}`);
  backend = spawn(exe, [], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: path.dirname(exe),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  });
  backend.stdout.setEncoding('utf8');
  backend.stderr.setEncoding('utf8');
  backend.stdout.on('data', chunk => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      handleBackendLine(line);
    }
  });
  backend.stderr.on('data', chunk => appendLog(`ERR ${chunk}`));
  backend.on('exit', (code, signal) => {
    appendLog(`EXIT code=${code} signal=${signal}`);
    backendReady = false;
    rejectAll(`El núcleo JARVIS terminó inesperadamente (${code ?? signal ?? 'unknown'})`);
    if (!shuttingDown && win && !win.isDestroyed()) {
      win.webContents.send('jarvis:event', { event: 'backend-exit', code, signal });
    }
  });
  backend.on('error', err => {
    appendLog(`SPAWN_ERROR ${err.stack || err}`);
    backendReady = false;
    rejectAll(err.message);
  });
}

function invokeBackend(op, args = {}, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    if (!backend || backend.killed) return reject(new Error('El núcleo JARVIS no está ejecutándose'));
    const id = nextId++;
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`JARVIS agotó el tiempo de espera en: ${op}`));
      }
    }, timeoutMs);
    pending.set(id, {
      resolve: v => { clearTimeout(timer); resolve(v); },
      reject: e => { clearTimeout(timer); reject(e); }
    });
    backend.stdin.write(JSON.stringify({ id, op, args }) + '\n', 'utf8');
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#010408',
    show: false,
    autoHideMenuBar: true,
    title: 'JARVIS GM',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  ipcMain.handle('jarvis:invoke', async (_event, op, args) => invokeBackend(op, args));
  ipcMain.handle('jarvis:backend-state', () => ({ ready: backendReady, log: logFile() }));
  ipcMain.handle('jarvis:open-log', async () => {
    const file = logFile();
    if (fs.existsSync(file)) await shell.openPath(file);
    return file;
  });
  try {
    startBackend();
    createWindow();
  } catch (err) {
    appendLog(`FATAL_START ${err.stack || err}`);
    dialog.showErrorBox('JARVIS GM', `No se pudo iniciar el núcleo completo de JARVIS.\n\n${err.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  shuttingDown = true;
  try {
    if (backend && !backend.killed) {
      backend.stdin.write(JSON.stringify({ id: nextId++, op: 'shutdown', args: {} }) + '\n');
      setTimeout(() => { try { backend.kill(); } catch (_) {} }, 1200).unref();
    }
  } catch (_) {}
});
