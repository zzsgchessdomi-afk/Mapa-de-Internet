import {app,BrowserWindow,ipcMain,dialog,Tray,Menu,nativeImage,Notification,shell,safeStorage} from 'electron';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import researchHandler from './app/api/research.js';
import inspectHandler from './app/api/inspect.js';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const appDir=path.join(__dirname,'app');
app.setAppUserModelId('com.atlanex.desktop');
let mainWindow=null,tray=null,monitorTimer=null,sidecarProc=null,isQuitting=false;
let sidecarBuffer='',rpcSeq=0,sidecarLastError='';
const rpcPending=new Map();
const RPC_PREFIX='ATLAS_RPC ';

const wait=ms=>new Promise(r=>setTimeout(r,ms));
function sideDir(){return app.isPackaged?path.join(process.resourcesPath,'agent-engine'):path.join(__dirname,'sidecar')}
function agentExe(){return process.platform==='win32'?path.join(sideDir(),'atlas-agent-engine.exe'):path.join(sideDir(),'atlas-agent-engine')}
function devPython(){return process.platform==='win32'?path.join(sideDir(),'.venv','Scripts','python.exe'):path.join(sideDir(),'.venv','bin','python')}
function agentConfigPath(){return path.join(app.getPath('userData'),'atlanex-agent-config.json')}

function readAgentConfig(){
 const envKey=String(process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY||'').trim();
 let saved={};
 try{saved=JSON.parse(fs.readFileSync(agentConfigPath(),'utf8'))}catch{}
 let key=envKey;
 if(!key&&saved.encryptedKey&&safeStorage.isEncryptionAvailable()){
  try{key=safeStorage.decryptString(Buffer.from(saved.encryptedKey,'base64')).trim()}catch{}
 }
 return {key,model:String(saved.model||process.env.ATLAS_MODEL||'gemini-2.5-flash').trim()||'gemini-2.5-flash'}
}
function geminiStatus(){
 const cfg=readAgentConfig();
 return {configured:!!cfg.key,model:cfg.model,secureStorage:safeStorage.isEncryptionAvailable()}
}
function saveAgentConfig(payload={}){
 const key=String(payload.key||'').trim(),model=String(payload.model||'gemini-2.5-flash').trim()||'gemini-2.5-flash';
 if(key&&!safeStorage.isEncryptionAvailable())throw new Error('El almacenamiento seguro de Windows no está disponible');
 const data={model,encryptedKey:key?safeStorage.encryptString(key).toString('base64'):''};
 fs.mkdirSync(path.dirname(agentConfigPath()),{recursive:true});
 fs.writeFileSync(agentConfigPath(),JSON.stringify(data,null,2),'utf8');
 return {configured:!!key,model,secureStorage:safeStorage.isEncryptionAvailable()}
}

function rejectRpcPending(error){
 for(const [id,p] of rpcPending){clearTimeout(p.timer);p.reject(error)}
 rpcPending.clear()
}
function handleSidecarStdout(chunk){
 sidecarBuffer+=String(chunk||'');
 for(;;){
  const nl=sidecarBuffer.indexOf('\n');if(nl<0)break;
  const line=sidecarBuffer.slice(0,nl).trim();sidecarBuffer=sidecarBuffer.slice(nl+1);
  if(!line.startsWith(RPC_PREFIX))continue;
  try{
   const msg=JSON.parse(line.slice(RPC_PREFIX.length)),pending=rpcPending.get(String(msg.id));
   if(!pending)continue;
   clearTimeout(pending.timer);rpcPending.delete(String(msg.id));
   msg.ok?pending.resolve(msg.result):pending.reject(new Error(msg.error||'Agent RPC error'))
  }catch(e){sidecarLastError=String(e?.message||e)}
 }
}
function rpcRequest(method,params={},timeout=30000){
 return new Promise((resolve,reject)=>{
  if(!sidecarProc||sidecarProc.exitCode!==null||!sidecarProc.stdin?.writable)return reject(new Error('Atlanex Agent Engine no disponible'));
  const id=String(++rpcSeq),timer=setTimeout(()=>{rpcPending.delete(id);reject(new Error('Agent RPC timeout: '+method))},timeout);
  rpcPending.set(id,{resolve,reject,timer});
  try{sidecarProc.stdin.write(JSON.stringify({id,method,params})+'\n')}
  catch(e){clearTimeout(timer);rpcPending.delete(id);reject(e)}
 })
}
function stopSidecar(){
 const p=sidecarProc;sidecarProc=null;sidecarBuffer='';
 rejectRpcPending(new Error('Agent Engine detenido'));
 try{p?.kill()}catch{}
}
async function startSidecar(){
 if(sidecarProc&&sidecarProc.exitCode===null)return true;
 let cmd,args;
 if(fs.existsSync(agentExe())){cmd=agentExe();args=['--stdio']}
 else if(fs.existsSync(devPython())){cmd=devPython();args=[path.join(sideDir(),'server.py'),'--stdio']}
 else return false;
 const cfg=readAgentConfig();
 sidecarLastError='';
 sidecarProc=spawn(cmd,args,{
  cwd:sideDir(),windowsHide:true,
  env:{...process.env,GEMINI_API_KEY:cfg.key,GOOGLE_API_KEY:cfg.key,ATLAS_MODEL:cfg.model},
  stdio:['pipe','pipe','pipe']
 });
 sidecarProc.stdout.setEncoding('utf8');sidecarProc.stdout.on('data',handleSidecarStdout);
 sidecarProc.stderr.setEncoding('utf8');sidecarProc.stderr.on('data',x=>{const s=String(x||'').trim();if(s)sidecarLastError=s.slice(-3000)});
 sidecarProc.on('exit',(code)=>{const err=new Error('Agent Engine terminó'+(code==null?'':' · código '+code)+(sidecarLastError?' · '+sidecarLastError:''));sidecarProc=null;rejectRpcPending(err)});
 for(let i=0;i<20;i++){
  try{const pong=await rpcRequest('ping',{},1500);if(pong?.ok)return true}catch{}
  await wait(100)
 }
 stopSidecar();return false
}
async function sidecarRpc(method,params={},timeout=30000){
 if(!sidecarProc||sidecarProc.exitCode!==null){
  if(!(await startSidecar()))throw new Error('Atlanex Agent Engine no disponible')
 }
 return await rpcRequest(method,params,timeout)
}

async function invokeHandler(handler,query={}){
 return await new Promise((resolve,reject)=>{
  let settled=false,statusCode=200;
  const headers={};
  const req={query};
  const finish=body=>{if(settled)return;settled=true;resolve({statusCode,headers,body})};
  const res={
   status(n){statusCode=Number(n)||statusCode;return res},
   setHeader(k,v){headers[String(k).toLowerCase()]=v;return res},
   json(x){finish(x);return res},
   end(x=''){let body=x;try{if(typeof x==='string'&&x.trim())body=JSON.parse(x)}catch{}finish(body);return res}
  };
  Promise.resolve(handler(req,res)).then(()=>{if(!settled)finish(null)}).catch(reject)
 })
}
async function researchPayload(q){
 const r=await invokeHandler(researchHandler,{q:String(q||'').slice(0,220)});
 if(r.statusCode>=400)throw new Error(r.body?.error||('Research error '+r.statusCode));
 return r.body||{}
}
async function inspectPayload(url){
 const r=await invokeHandler(inspectHandler,{url:String(url||'')});
 if(r.statusCode>=400)throw new Error(r.body?.error||('Inspect error '+r.statusCode));
 return r.body||{}
}

function monitorPath(){return path.join(app.getPath('userData'),'atlas-monitors.json')}
const defaultMonitor=()=>({enabled:true,startWithWindows:false,jobs:[],events:[]});
function loadMonitor(){try{const x=JSON.parse(fs.readFileSync(monitorPath(),'utf8'));return{...defaultMonitor(),...x,jobs:Array.isArray(x.jobs)?x.jobs:[],events:Array.isArray(x.events)?x.events:[]}}catch{return defaultMonitor()}}
function saveMonitor(x){try{fs.mkdirSync(path.dirname(monitorPath()),{recursive:true});fs.writeFileSync(monitorPath(),JSON.stringify(x,null,2));return true}catch{return false}}
function cleanJob(j){try{const u=new URL(String(j?.url||''));if(!['http:','https:'].includes(u.protocol))return null;return{id:String(j.id||crypto.randomUUID()),title:String(j.title||u.href).slice(0,180),url:u.href,intervalMinutes:Math.max(15,Math.min(10080,Number(j.intervalMinutes)||360)),enabled:j.enabled!==false,lastChecked:Number(j.lastChecked)||0,nextCheck:Number(j.nextCheck)||0,lastHash:String(j.lastHash||''),lastTitle:String(j.lastTitle||''),changed:!!j.changed,failures:Number(j.failures)||0,lastError:j.lastError||null,history:Array.isArray(j.history)?j.history.slice(-30):[]}}catch{return null}}
async function scanMonitor(url){const j=await inspectPayload(url),s=j.snapshot||{},h=String(s.contentHash||j.contentHash||'');if(!/^[a-f0-9]{64}$/i.test(h))throw new Error('SHA-256 ausente');return{hash:h,title:s.title||j.title||url,fetchedAt:s.fetchedAt||j.fetchedAt||new Date().toISOString()}}
async function monitorTick(force=false){const s=loadMonitor();if(!s.enabled&&!force)return s;for(const job of s.jobs){if(!job.enabled||(!force&&job.nextCheck>Date.now()))continue;const now=Date.now();try{const before=job.lastHash||'',snap=await scanMonitor(job.url);Object.assign(job,{lastChecked:now,nextCheck:now+job.intervalMinutes*60000,lastHash:snap.hash,lastTitle:snap.title,changed:!!before&&before!==snap.hash,failures:0,lastError:null});job.history=[...(job.history||[]),{at:now,hash:snap.hash,previousHash:before||null,changed:job.changed,fetchedAt:snap.fetchedAt}].slice(-30);if(job.changed&&Notification.isSupported())new Notification({title:'Atlanex · cambio detectado',body:job.title}).show()}catch(e){job.lastChecked=now;job.failures=(job.failures||0)+1;job.lastError=String(e?.message||e);job.nextCheck=now+Math.min(job.intervalMinutes,60)*60000}}saveMonitor(s);return s}
function startMonitor(){clearInterval(monitorTimer);monitorTimer=setInterval(()=>monitorTick(false).catch(()=>{}),60000);setTimeout(()=>monitorTick(false).catch(()=>{}),6000)}
function setLogin(v){try{app.setLoginItemSettings({openAtLogin:!!v,args:v?['--background']:[]});return app.getLoginItemSettings().openAtLogin}catch{return false}}

function isLocalAppFile(url){
 try{
  const u=new URL(url);if(u.protocol!=='file:')return false;
  const file=path.normalize(fileURLToPath(u));const base=path.normalize(appDir+path.sep);
  return file===path.join(appDir,'index.html')||file.startsWith(base)
 }catch{return false}
}
function createWindow(show=true){
 mainWindow=new BrowserWindow({width:1440,height:900,minWidth:1050,minHeight:680,frame:false,show:false,backgroundColor:'#02050a',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 mainWindow.loadFile(path.join(appDir,'index.html'));
 mainWindow.webContents.setWindowOpenHandler(({url})=>{
  try{
   const u=new URL(url);
   if(isLocalAppFile(url))return{action:'allow'};
   if(u.hostname.endsWith('puter.com')||u.hostname.endsWith('puter.site'))return{action:'allow'};
   if(['http:','https:'].includes(u.protocol))shell.openExternal(url)
  }catch{}
  return{action:'deny'}
 });
 if(show)mainWindow.once('ready-to-show',()=>mainWindow.show());
 mainWindow.on('close',e=>{if(!isQuitting&&process.platform!=='darwin'){e.preventDefault();mainWindow.hide()}});
 mainWindow.on('closed',()=>{mainWindow=null});
 return mainWindow
}
function createTray(){try{const p=path.join(appDir,'icons','icon-192.png');if(!fs.existsSync(p))return;tray=new Tray(nativeImage.createFromPath(p).resize({width:18,height:18}));tray.setToolTip('Atlanex');tray.setContextMenu(Menu.buildFromTemplate([{label:'Abrir Atlanex',click:()=>{mainWindow?.show();mainWindow?.focus()}},{label:'Revisar monitores ahora',click:()=>monitorTick(true).catch(()=>{})},{type:'separator'},{label:'Salir completamente',click:()=>{isQuitting=true;app.quit()}}]));tray.on('double-click',()=>mainWindow?.show())}catch{}}
function acceptanceLog(payload){try{const p=process.env.ATLAS_ACCEPTANCE_LOG;if(p)fs.writeFileSync(p,JSON.stringify(payload,null,2),'utf8')}catch{}}
async function rendererCheck(win){
 const consoleErrors=[],preloadErrors=[];
 win.webContents.on('console-message',(_e,level,message)=>{if(level>=2)consoleErrors.push(String(message).slice(0,500))});
 win.webContents.on('preload-error',(_e,preloadPath,error)=>preloadErrors.push({preloadPath,error:String(error?.message||error)}));
 await win.loadFile(path.join(appDir,'index.html'));
 await win.webContents.executeJavaScript("document.readyState==='complete'?true:new Promise(r=>addEventListener('load',()=>r(true),{once:true}))");
 return await win.webContents.executeJavaScript(`(()=>{const fatal=document.getElementById('atlasFatal');const fatalText=document.getElementById('atlasFatalText');const body=(document.body?.innerText||'').toLowerCase();return{atlas:(document.title||'').toLowerCase().includes('atlanex')||body.includes('atlanex'),title:document.title||'',splash:!!document.getElementById('splash'),machine:!!document.getElementById('launchMachine'),fatal:!!fatal&&getComputedStyle(fatal).display!=='none',fatalText:fatalText?.textContent||'',desktop:!!globalThis.atlasDesktop?.isDesktop}})()`).then(x=>({...x,consoleErrors,preloadErrors}))
}

async function runSmoke(){
 let win;
 try{
  win=createWindow(false);
  const r=await rendererCheck(win);
  if(!r.atlas||!r.splash||!r.machine||r.fatal||!r.desktop)throw new Error('renderer/preload smoke failed '+JSON.stringify(r));
  if(app.isPackaged){
   const x=spawnSync(agentExe(),['--self-test'],{encoding:'utf8',timeout:120000,windowsHide:true});
   if(x.status!==0)throw new Error('agent self-test failed '+(x.stderr||x.stdout||''));
   let payload={};try{payload=JSON.parse((x.stdout||'').trim().split(/\r?\n/).filter(Boolean).at(-1)||'{}')}catch{}
   if(!payload.ok||!payload.stdio_rpc||!payload.no_loopback_runtime)throw new Error('agent transport self-test failed '+(x.stdout||''));
   if(!fs.existsSync(path.join(sideDir(),'THIRD_PARTY_PYTHON_LICENSES.json')))throw new Error('license inventory missing')
  }
  console.log(JSON.stringify({ok:true,renderer:true,preload:true,transport:'ipc+stdio'}));return 0
 }catch(e){console.error(JSON.stringify({ok:false,error:String(e?.message||e)}));return 1}
 finally{try{win?.destroy()}catch{}}
}
async function runAcceptance(){
 let backup=null,had=false,win=null;
 try{
  win=createWindow(false);
  const renderer=await rendererCheck(win);
  if(!renderer.atlas||!renderer.machine||renderer.fatal||!renderer.desktop)throw new Error('renderer/preload acceptance failed '+JSON.stringify(renderer));

  const research=await researchPayload('OpenAI API official documentation');
  const providers=new Set((research.diagnostics||[]).filter(x=>x.ok).map(x=>x.provider)).size;
  if(!(research.results||[]).length||providers<3)throw new Error('live research acceptance failed');

  const proofUrl='https://en.wikipedia.org/wiki/OpenAI',ins=await inspectPayload(proofUrl),snap=ins.snapshot||{};
  if(!/^[a-f0-9]{64}$/i.test(String(snap.contentHash||ins.contentHash||''))||String(snap.text||ins.text||'').length<500)throw new Error('live source snapshot/hash acceptance failed');

  const mp=monitorPath();had=fs.existsSync(mp);if(had)backup=fs.readFileSync(mp);
  const st=defaultMonitor(),job=cleanJob({id:'acceptance-live-source',title:'Acceptance source',url:proofUrl,intervalMinutes:15});
  st.jobs=[job];if(!saveMonitor(st))throw new Error('monitor persistence write failed');
  await monitorTick(true);
  const loaded=loadMonitor().jobs[0];
  if(!loaded?.lastHash||!loaded.lastChecked||loaded.failures||!loaded.history?.length)throw new Error('monitor persistence live check failed');

  if(!app.isPackaged)throw new Error('acceptance must run packaged');
  const ag=spawnSync(agentExe(),['--self-test-deep'],{encoding:'utf8',timeout:300000,windowsHide:true});
  let payload={};try{payload=JSON.parse((ag.stdout||'').trim().split(/\r?\n/).filter(Boolean).at(-1)||'{}')}catch{}
  if(ag.status!==0||!payload.ok||!payload.crewai_runtime||!payload.gpt_researcher_runtime||!payload.google_genai_adapter||!payload.stdio_rpc||!payload.no_loopback_runtime||!payload.provider_objects)throw new Error('agent deep acceptance failed '+(ag.stderr||ag.stdout||''));

  if(!fs.existsSync(path.join(sideDir(),'THIRD_PARTY_PYTHON_LICENSES.json'))||!fs.existsSync(path.join(sideDir(),'THIRD_PARTY_NOTICES.md')))throw new Error('packaged legal inventory missing');
  const result={ok:true,renderer,transport:{renderer:'electron-ipc',agent:'stdio-json-rpc',loopback:false},liveResearch:{results:research.results.length,providers},snapshot:{sha256:snap.contentHash||ins.contentHash},monitor:{persisted:true},agentEngine:{crewai:true,gptResearcher:true,geminiAdapter:true,stdio:true,noLoopback:true}};
  acceptanceLog(result);console.log(JSON.stringify(result));return 0
 }catch(e){
  const result={ok:false,error:String(e?.message||e),stack:String(e?.stack||'').slice(-4000)};
  acceptanceLog(result);console.error(JSON.stringify(result));return 1
 }finally{
  try{win?.destroy()}catch{}
  try{const mp=monitorPath();if(had&&backup)fs.writeFileSync(mp,backup);else if(!had&&fs.existsSync(mp))fs.unlinkSync(mp)}catch{}
 }
}

const lock=app.requestSingleInstanceLock();
if(!lock)app.quit();
else{
 app.on('second-instance',()=>{mainWindow?.show();mainWindow?.focus()});
 app.whenReady().then(async()=>{
  if(process.argv.includes('--acceptance-test')){isQuitting=true;return app.exit(await runAcceptance())}
  if(process.argv.includes('--smoke-test')){isQuitting=true;return app.exit(await runSmoke())}
  createWindow(true);createTray();startMonitor();
  const m=loadMonitor();if(m.startWithWindows)setLogin(true);
  if(process.argv.includes('--background'))mainWindow?.hide();
  if(fs.existsSync(agentExe())||fs.existsSync(devPython()))startSidecar().catch(()=>{})
 });
 app.on('activate',()=>{if(!mainWindow)createWindow();else{mainWindow.show();mainWindow.focus()}});
 app.on('window-all-closed',()=>{});
 app.on('before-quit',()=>{isQuitting=true;clearInterval(monitorTimer);stopSidecar()})
}

ipcMain.handle('atlas:window',(_e,a)=>{if(!mainWindow)return false;if(a==='minimize')mainWindow.minimize();else if(a==='maximize')mainWindow.isMaximized()?mainWindow.unmaximize():mainWindow.maximize();else if(a==='close')mainWindow.close();else if(a==='fullscreen')mainWindow.setFullScreen(!mainWindow.isFullScreen());return true});
ipcMain.handle('atlas:save-project',async(_e,{text,defaultName})=>{const x=await dialog.showSaveDialog(mainWindow,{title:'Guardar proyecto Atlanex',defaultPath:path.join(app.getPath('documents'),defaultName||'Atlas_Project.atlas.json'),filters:[{name:'Atlanex Project',extensions:['json']}]});if(x.canceled||!x.filePath)return false;fs.writeFileSync(x.filePath,text,'utf8');return true});
ipcMain.handle('atlas:open-project',async()=>{const x=await dialog.showOpenDialog(mainWindow,{title:'Abrir proyecto Atlanex',properties:['openFile'],filters:[{name:'Atlanex Project',extensions:['json']}]});if(x.canceled||!x.filePaths[0])return null;return{path:x.filePaths[0],text:fs.readFileSync(x.filePaths[0],'utf8')}});
ipcMain.handle('atlas:notify',(_e,{title,body})=>{if(Notification.isSupported())new Notification({title:title||'Atlanex',body:body||''}).show();return true});
ipcMain.handle('atlas:research',async(_e,{q}={})=>await researchPayload(q));
ipcMain.handle('atlas:inspect',async(_e,{url}={})=>await inspectPayload(url));
ipcMain.handle('atlas:gemini-status',()=>geminiStatus());
ipcMain.handle('atlas:gemini-configure',async(_e,p={})=>{
 const status=saveAgentConfig(p);stopSidecar();
 if(fs.existsSync(agentExe())||fs.existsSync(devPython()))await startSidecar().catch(()=>false);
 return status
});
ipcMain.handle('atlas:agent-health',async()=>{try{return await sidecarRpc('health',{},10000)}catch(e){return{ready:false,runtime_ready:false,message:String(e?.message||e)}}});
ipcMain.handle('atlas:agent-doctor',async()=>{try{return await sidecarRpc('doctor',{},60000)}catch(e){return{ready:false,error:String(e?.message||e)}}});
ipcMain.handle('atlas:agent-smoke',async()=>{try{return await sidecarRpc('smoke',{},30000)}catch(e){return{ok:false,error:String(e?.message||e)}}});
ipcMain.handle('atlas:agent-repair',async()=>{stopSidecar();return await startSidecar()});
ipcMain.handle('atlas:agent-setup',async()=>await startSidecar());
ipcMain.handle('atlas:agent-setup-status',()=>({running:false,done:!!sidecarProc,ok:!!sidecarProc,progress:sidecarProc?100:0,line:sidecarProc?'Agent Engine listo · stdio':'No iniciado'}));
ipcMain.handle('atlas:agent-start',async(_e,p)=>await sidecarRpc('runs.start',p||{},30000));
ipcMain.handle('atlas:agent-run',async(_e,id)=>await sidecarRpc('runs.get',{run_id:id},10000));
ipcMain.handle('atlas:agent-cancel',async(_e,id)=>await sidecarRpc('runs.cancel',{run_id:id},10000));
ipcMain.handle('atlas:open-evidence',async(_e,{url})=>{try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))return false;const w=new BrowserWindow({width:1180,height:820,parent:mainWindow||undefined,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});w.loadURL(u.href);return true}catch{return false}});
ipcMain.handle('atlas:monitor-list',()=>loadMonitor());
ipcMain.handle('atlas:monitor-sync',async(_e,p)=>{const old=loadMonitor(),map=new Map(old.jobs.map(j=>[j.id,j])),jobs=[];for(const raw of(p?.jobs||[])){const j=cleanJob(raw);if(!j)continue;const x=map.get(j.id);jobs.push(x?{...j,lastChecked:x.lastChecked,lastHash:x.lastHash,lastTitle:x.lastTitle,changed:x.changed,failures:x.failures,lastError:x.lastError,history:x.history,nextCheck:x.nextCheck}:j)}old.jobs=jobs;saveMonitor(old);return loadMonitor()});
ipcMain.handle('atlas:monitor-run-now',async()=>await monitorTick(true));
ipcMain.handle('atlas:monitor-config',(_e,p)=>{const s=loadMonitor();if(typeof p?.enabled==='boolean')s.enabled=p.enabled;if(typeof p?.startWithWindows==='boolean'){s.startWithWindows=p.startWithWindows;setLogin(s.startWithWindows)}saveMonitor(s);return s});
ipcMain.handle('atlas:pick-research-files',async()=>{const r=await dialog.showOpenDialog(mainWindow,{title:'Añadir documentos a Atlanex',properties:['openFile','multiSelections'],filters:[{name:'Documentos',extensions:['pdf','txt','md','json','html','htm','csv','xml']}]});if(r.canceled)return[];const out=[];for(const file of r.filePaths.slice(0,12)){try{const st=fs.statSync(file);if(st.size>20000000){out.push({name:path.basename(file),error:'Archivo mayor de 20 MB'});continue}const ext=path.extname(file).toLowerCase();let text='',kind='text';if(ext==='.pdf'){const{PDFParse}=await import('pdf-parse');const parser=new PDFParse({data:new Uint8Array(fs.readFileSync(file))});try{text=String((await parser.getText())?.text||'');kind='pdf'}finally{try{await parser.destroy()}catch{}}}else{text=fs.readFileSync(file,'utf8');if(ext==='.html'||ext==='.htm')text=text.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}text=text.slice(0,180000);if(!text.trim()){out.push({name:path.basename(file),error:'No se pudo extraer texto'});continue}out.push({name:path.basename(file),kind,size:st.size,text,contentHash:crypto.createHash('sha256').update(text,'utf8').digest('hex'),fetchedAt:new Date().toISOString()})}catch(e){out.push({name:path.basename(file),error:String(e?.message||e).slice(0,300)})}}return out});
ipcMain.handle('atlas:version',()=>app.getVersion());
