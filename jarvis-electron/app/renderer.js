const $ = (id) => document.getElementById(id);
const fmt = (v) => typeof v === 'string' ? v : JSON.stringify(v, null, 2);
const panelMeta = {
  command:['JARVIS','Orden directa al núcleo real'],
  perception:['Voz & Gestos','Percepción multimodal y capa de intención'],
  memory:['Memoria','Continuidad, proyectos y contexto persistente'],
  research:['Research Corps','Investigación multiagente con evidencia'],
  workbench:['Autonomous Workbench','Trabajos persistentes y checkpoints'],
  swarm:['Cognitive Swarm','Especialistas dinámicos, crítico y síntesis'],
  skills:['Skills & Evolution','Skill Forge, benchmark y evolución controlada'],
  world:['World Model','Modelo vivo de tu entorno y relaciones'],
  mobile:['Móvil','Dispositivos autorizados y acciones móviles'],
  reality:['Reality Bridge','Dispositivos físicos enrolados'],
  security:['Guardian & Permisos','Autoridad final del propietario'],
  settings:['IA & Diagnóstico','Proveedor, self-test y estado del release']
};

let status = null;
let busyCount = 0;

function busy(on){
  busyCount += on ? 1 : -1;
  busyCount = Math.max(0,busyCount);
  document.body.classList.toggle('busy', busyCount>0);
}

async function call(op,args={},outputId=null){
  busy(true);
  try{
    const result = await window.jarvis.invoke(op,args);
    if(outputId) $(outputId).textContent = fmt(result);
    return result;
  }catch(err){
    const text = `ERROR: ${err.message}`;
    if(outputId) $(outputId).textContent = text;
    else alert(text);
    throw err;
  }finally{busy(false)}
}

function renderStatus(s){
  status = s;
  const p = s.perception || {};
  const items = [
    ['Core', s.mode || 'Infinity 7'],
    ['STOP', s.stop_engaged ? 'ENGAGED' : 'Ready'],
    ['Voz', p.voice?.running ? 'ON' : 'OFF'],
    ['Visión', p.vision?.running ? 'ON' : 'OFF'],
    ['Workbench', `${s.workbench?.total ?? 0} jobs`],
    ['World', `${s.world?.entities ?? 0} entities`]
  ];
  $('statusStrip').innerHTML = items.map(([a,b],i)=>`<div class="status-chip s${i}"><b>${a}</b><span>${String(b)}</span></div>`).join('');
  const voiceRunning = !!p.voice?.running;
  $('voiceBadge').textContent = voiceRunning ? 'ESCUCHANDO' : (p.voice?.status === 'error' || p.voice?.status === 'unavailable' ? 'VOZ NO DISPONIBLE' : 'VOZ INICIANDO');
  $('voiceBadge').classList.toggle('bad', p.voice?.status === 'error' || p.voice?.status === 'unavailable');
  $('presenceOrb').classList.toggle('listening', voiceRunning);
  if($('hudVoice')) $('hudVoice').textContent = voiceRunning ? 'ONLINE' : 'OFFLINE';
  if($('hudWork')) $('hudWork').textContent = (s.workbench?.total ?? 0) > 0 ? 'ACTIVE' : 'READY';
  if($('hudWorld')) $('hudWorld').textContent = (s.world?.entities ?? 0) > 0 ? 'SYNC' : 'EMPTY';
  if($('hudGuardian')) $('hudGuardian').textContent = s.stop_engaged ? 'LOCKED' : 'ARMED';
  $('stopBtn').classList.toggle('engaged', !!s.stop_engaged);
  $('resetStop').disabled = !s.stop_engaged;
  $('backendDot').className = 'dot ok';
  $('backendText').textContent = voiceRunning ? `JARVIS escuchando • ${s.version}` : `Núcleo real ${s.version}`;
  $('perceptionOutput').textContent = fmt(p);
  renderPermissions(s.permissions || {});
}

async function refreshStatus(){
  try{renderStatus(await call('status'));}
  catch(_){$('backendDot').className='dot bad';$('backendText').textContent='Núcleo no disponible';}
}

function renderPermissions(perms){
  const root=$('permissionsGrid');
  root.innerHTML='';
  Object.entries(perms).sort(([a],[b])=>a.localeCompare(b)).forEach(([cap,allowed])=>{
    const row=document.createElement('div');row.className='perm';
    const label=document.createElement('span');label.textContent=cap;
    const input=document.createElement('input');input.type='checkbox';input.className='switch';input.checked=!!allowed;
    input.addEventListener('change', async()=>{
      input.disabled=true;
      try{await call('set_permission',{capability:cap,allowed:input.checked});await refreshStatus();}
      catch(_){input.checked=!input.checked}
      finally{input.disabled=false}
    });
    row.append(label,input);root.appendChild(row);
  });
}


const systemsToggle = $('systemsToggle');
const systemsClose = $('systemsClose');
const sidebar = document.querySelector('.sidebar');
if(systemsToggle) systemsToggle.addEventListener('click',()=>sidebar.classList.toggle('open'));
if(systemsClose) systemsClose.addEventListener('click',()=>sidebar.classList.remove('open'));

for(const btn of document.querySelectorAll('.nav')){
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
    btn.classList.add('active');
    const key=btn.dataset.panel;
    $(`panel-${key}`).classList.add('active');
    $('panelTitle').textContent=panelMeta[key][0];$('panelSubtitle').textContent=panelMeta[key][1];
    sidebar.classList.remove('open');
  });
}

document.querySelectorAll('[data-op]').forEach(btn=>btn.addEventListener('click',async()=>{
  try{const r=await call(btn.dataset.op);$('perceptionOutput').textContent=fmt(r);await refreshStatus();}catch(_){}
}));

let pendingPermission = null;

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function addChat(role, text, extra=''){
  const input=$('lastInput'), response=$('lastResponse');
  if(role==='user') input.textContent=String(text||'—').toUpperCase();
  else response.textContent=String(text||'SYSTEM READY').toUpperCase();
  return null;
}

function commandDetails(_result){ return ''; }

function showCommandResult(result){
  const extra = commandDetails(result);
  addChat('jarvis', result.message || 'Orden procesada.', extra);
  $('goalOutput').textContent = result.message || '';
  if(result.needs_permission && result.capability){
    pendingPermission={text:result.text,capability:result.capability};
    $('permissionTitle').textContent='Necesito tu autorización';
    $('permissionText').textContent=`Para continuar necesito permiso para ${result.capability_label || result.capability}.`;
    $('permissionBar').classList.remove('hidden');
  }else{
    pendingPermission=null;
    $('permissionBar').classList.add('hidden');
  }
}

async function executeGoal(text, authorizedMode=null){
  if(!text)return;
  addChat('user',text);
  $('goalOutput').textContent='Trabajando…';
  $('runGoal').disabled=true;
  try{
    const result = authorizedMode
      ? await call('run_goal_authorized',{text,capability:pendingPermission.capability,mode:authorizedMode})
      : await call('run_goal',{text});
    showCommandResult(result);
    if(result.state==='verified') $('goalInput').value='';
  }catch(err){
    addChat('jarvis',`No pude completar la orden: ${err.message}`);
    $('goalOutput').textContent=`No pude completar la orden: ${err.message}`;
  }finally{
    $('runGoal').disabled=false;
    await refreshStatus();
  }
}

$('runGoal').addEventListener('click',async()=>{
  const text=$('goalInput').value.trim();
  await executeGoal(text);
});
$('allowOnce').addEventListener('click',async()=>{
  if(!pendingPermission)return;
  const p={...pendingPermission};
  $('permissionBar').classList.add('hidden');
  if(p.source==='voice'){
    await call('voice_permission',{mode:'once'});
    pendingPermission=null;
  }else{
    pendingPermission=p;
    await executeGoal(p.text,'once');
  }
});
$('allowAlways').addEventListener('click',async()=>{
  if(!pendingPermission)return;
  const p={...pendingPermission};
  $('permissionBar').classList.add('hidden');
  if(p.source==='voice'){
    await call('voice_permission',{mode:'always'});
    pendingPermission=null;
  }else{
    pendingPermission=p;
    await executeGoal(p.text,'always');
  }
});
$('denyPermission').addEventListener('click',async()=>{
  const p=pendingPermission;
  pendingPermission=null;
  $('permissionBar').classList.add('hidden');
  if(p?.source==='voice') await call('voice_permission',{mode:'cancel'});
  else addChat('jarvis','Entendido. No haré esa acción.');
});
$('goalInput').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter')$('runGoal').click()});
$('screenNow').addEventListener('click',()=>call('screen_snapshot',{},'goalOutput'));
$('refreshStatus').addEventListener('click',refreshStatus);
$('stopBtn').addEventListener('click',async()=>{await call('stop');await refreshStatus();});
$('resetStop').addEventListener('click',async()=>{await call('reset_stop');await refreshStatus();});
$('speakBtn').addEventListener('click',()=>call('speak',{text:$('speakText').value},'perceptionOutput'));

$('memoryRemember').addEventListener('click',()=>call('memory_remember',{title:$('memoryTitle').value,content:$('memoryContent').value},'memoryOutput'));
$('memorySearch').addEventListener('click',()=>call('memory_search',{query:$('memoryQuery').value},'memoryOutput'));
$('memoryResume').addEventListener('click',()=>call('memory_resume',{query:$('memoryQuery').value},'memoryOutput'));

$('researchRun').addEventListener('click',()=>call('research_run',{question:$('researchQuestion').value,depth:$('researchDepth').value},'researchOutput'));
$('researchList').addEventListener('click',()=>call('research_list',{},'researchOutput'));

$('workCreate').addEventListener('click',()=>call('workbench_create',{goal:$('workGoal').value},'workOutput'));
$('workCycle').addEventListener('click',()=>call('workbench_cycle',{},'workOutput'));
$('workList').addEventListener('click',()=>call('workbench_list',{},'workOutput'));

$('swarmRun').addEventListener('click',()=>call('swarm_run',{goal:$('swarmGoal').value},'swarmOutput'));
$('swarmList').addEventListener('click',()=>call('swarm_list',{},'swarmOutput'));
$('skillsList').addEventListener('click',()=>call('skills_list',{},'skillsOutput'));
$('evolutionScan').addEventListener('click',()=>call('evolution_scan',{},'skillsOutput'));
$('evolutionList').addEventListener('click',()=>call('evolution_list',{},'skillsOutput'));
$('worldRefresh').addEventListener('click',()=>call('world_snapshot',{},'worldOutput'));
$('mobileRefresh').addEventListener('click',()=>call('mobile_summary',{},'mobileOutput'));
$('realityStatus').addEventListener('click',()=>call('reality_status',{},'realityOutput'));
$('realityList').addEventListener('click',()=>call('reality_list',{},'realityOutput'));

$('saveProvider').addEventListener('click',async()=>{
  const result=await call('provider_set',{model:$('modelInput').value,api_key:$('apiKeyInput').value},'settingsOutput');
  $('apiKeyInput').value='';await refreshStatus();
});
$('selfTest').addEventListener('click',()=>call('self_test',{},'settingsOutput'));
$('diagnostics').addEventListener('click',()=>call('diagnostics',{},'settingsOutput'));
$('releaseGate').addEventListener('click',()=>call('release_gate',{},'settingsOutput'));
$('openLog').addEventListener('click',()=>window.jarvis.openLog());

window.jarvis.onEvent((evt)=>{
  if(evt.event==='ready'){refreshStatus();}
  if(evt.event==='voice-status'){
    const ok=evt.status==='running';
    $('voiceBadge').textContent=ok?'ESCUCHANDO':(evt.status==='error'||evt.status==='unavailable'?'VOZ NO DISPONIBLE':'VOZ INICIANDO');
    $('voiceBadge').classList.toggle('bad',evt.status==='error'||evt.status==='unavailable');
    $('presenceOrb').classList.toggle('listening',ok);
    if(evt.status==='error'||evt.status==='unavailable') addChat('jarvis',`La voz no está disponible: ${evt.detail||evt.status}`);
  }
  if(evt.event==='voice-wake'){
    $('wakeHint').textContent='Te escucho…';
    $('presenceOrb').classList.add('awake');
    setTimeout(()=>$('presenceOrb').classList.remove('awake'),2200);
  }
  if(evt.event==='voice-command'){
    addChat('user',evt.text);
    $('wakeHint').textContent='Procesando tu orden…';
  }
  if(evt.event==='assistant' && evt.text){
    addChat('jarvis',evt.text);
    $('wakeHint').textContent='Di “JARVIS”';
  }
  if(evt.event==='voice-permission'){
    pendingPermission={source:'voice',text:evt.text,capability:evt.capability};
    $('permissionTitle').textContent='JARVIS necesita tu autorización';
    $('permissionText').textContent=evt.prompt||`Necesito permiso para ${evt.capability_label||evt.capability}.`;
    $('permissionBar').classList.remove('hidden');
  }
  if(evt.event==='voice-permission-cleared'){
    if(pendingPermission?.source==='voice') pendingPermission=null;
    $('permissionBar').classList.add('hidden');
  }
  if(evt.event==='fatal'||evt.event==='backend-exit'){
    $('backendDot').className='dot bad';$('backendText').textContent='Núcleo detenido';
    $('goalOutput').textContent=`El núcleo JARVIS se detuvo: ${evt.error||evt.code||'error desconocido'}`;
  }
});

(async()=>{
  addChat('jarvis','Estoy activo. Di “JARVIS” y háblame. Puedes escribir solo si lo necesitas.');
  const state=await window.jarvis.state();
  if(state.ready) await refreshStatus();
  else setTimeout(refreshStatus,1200);
  try{
    const p=await call('provider_get');$('modelInput').value=p.model||$('modelInput').value;
  }catch(_){}
})();
