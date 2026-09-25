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
  $('voiceBadge').textContent = voiceRunning ? 'LISTENING' : (p.voice?.status === 'error' || p.voice?.status === 'unavailable' ? 'VOICE ERROR' : 'VOICE INITIALIZING');
  $('voiceBadge').classList.toggle('bad', p.voice?.status === 'error' || p.voice?.status === 'unavailable');
  $('presenceOrb').classList.toggle('listening', voiceRunning);
  $('stopBtn').classList.toggle('engaged', !!s.stop_engaged);
  $('resetStop').disabled = !s.stop_engaged;
  if($('perceptionOutput')) $('perceptionOutput').textContent = fmt(p);
  renderPermissions(s.permissions || {});
}

async function refreshStatus(){
  try{renderStatus(await call('status'));}
  catch(_){ $('voiceBadge').textContent='CORE OFFLINE'; $('voiceBadge').classList.add('bad'); }
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


document.querySelectorAll('[data-op]').forEach(btn=>btn.addEventListener('click',async()=>{
  try{const r=await call(btn.dataset.op);$('perceptionOutput').textContent=fmt(r);await refreshStatus();}catch(_){}
}));

let pendingPermission = null;

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function setHudMessage(role, text, extra=''){
  const input=$('lastInput'), response=$('lastResponse');
  if(role==='user'){
    if(input) input.textContent=String(text||'—').toUpperCase();
    document.body.classList.add('thinking');
  }else{
    if(response) response.textContent=String(text||'SYSTEM READY').toUpperCase();
    document.body.classList.remove('thinking');
  }
  return null;
}

function commandDetails(_result){ return ''; }

function showCommandResult(result){
  const extra = commandDetails(result);
  setHudMessage('jarvis', result.message || 'Orden procesada.', extra);
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
  setHudMessage('user',text);
  $('goalOutput').textContent='Trabajando…';
  $('runGoal').disabled=true;
  try{
    const result = authorizedMode
      ? await call('run_goal_authorized',{text,capability:pendingPermission.capability,mode:authorizedMode})
      : await call('run_goal',{text});
    showCommandResult(result);
    if(result.state==='verified') $('goalInput').value='';
  }catch(err){
    setHudMessage('jarvis',`No pude completar la orden: ${err.message}`);
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
  else setHudMessage('jarvis','Entendido. No haré esa acción.');
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
    $('voiceBadge').textContent=ok?'LISTENING':(evt.status==='error'||evt.status==='unavailable'?'VOICE ERROR':'VOICE INITIALIZING');
    $('voiceBadge').classList.toggle('bad',evt.status==='error'||evt.status==='unavailable');
    $('presenceOrb').classList.toggle('listening',ok);
    if(evt.status==='error'||evt.status==='unavailable') setHudMessage('jarvis',`La voz no está disponible: ${evt.detail||evt.status}`);
  }
  if(evt.event==='voice-wake'){
    $('wakeHint').textContent='TE ESCUCHO';
    
    $('presenceOrb').classList.add('awake');
    setTimeout(()=>$('presenceOrb').classList.remove('awake'),2200);
  }
  if(evt.event==='voice-command'){
    setHudMessage('user',evt.text);
    $('wakeHint').textContent='PROCESSING';
    
  }
  if(evt.event==='assistant' && evt.text){
    setHudMessage('jarvis',evt.text);
    $('wakeHint').textContent='DI “JARVIS”';
    
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
    $('voiceBadge').textContent='CORE STOPPED';
    $('voiceBadge').classList.add('bad');
    $('goalOutput').textContent=`El núcleo JARVIS se detuvo: ${evt.error||evt.code||'error desconocido'}`;
  }
});

(async()=>{
  setHudMessage('jarvis','JARVIS ONLINE');
  const state=await window.jarvis.state();
  if(state.ready) await refreshStatus();
  else setTimeout(refreshStatus,1200);
  try{
    const p=await call('provider_get');$('modelInput').value=p.model||$('modelInput').value;
  }catch(_){}
})();

function showPanel(key){
  document.querySelectorAll('.dock-btn').forEach(x=>x.classList.toggle('active',x.dataset.panel===key));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  const target=document.getElementById('panel-'+key);
  if(target) target.classList.add('active');
}
document.querySelectorAll('[data-panel]').forEach(btn=>btn.addEventListener('click',()=>showPanel(btn.dataset.panel)));
document.addEventListener('keydown',e=>{if(e.key==='Escape')showPanel('command');});


/* --- Cinematic JARVIS visualization: reactive, no external assets --- */
(() => {
  const canvas = document.getElementById('cinematicCanvas');
  const stage = document.querySelector('.reference-stage');
  const core = document.getElementById('presenceOrb');
  if (!canvas || !stage || !core) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  let w=0,h=0,dpr=1,cx=0,cy=0,last=performance.now();
  let particles=[], phase=0, pulse=0, awakeBurst=0;

  function resize(){
    const r=stage.getBoundingClientRect();
    dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
    w=Math.max(1,r.width); h=Math.max(1,r.height);
    canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr);
    canvas.style.width=w+'px'; canvas.style.height=h+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const cr=core.getBoundingClientRect(), sr=stage.getBoundingClientRect();
    cx=cr.left-sr.left+cr.width/2; cy=cr.top-sr.top+cr.height/2;
    seedParticles();
  }

  function seedParticles(){
    const count=Math.max(55,Math.min(120,Math.floor((w*h)/15000)));
    particles=Array.from({length:count},(_,i)=>{
      const a=(i/count)*Math.PI*2 + ((i*37)%19)*0.03;
      const radius=115 + ((i*47)%320);
      return {a,r:radius,spd:(0.00008+((i*13)%17)*0.000006)*(i%2?1:-1),z:.25+((i*29)%70)/100,s:0.35+((i*11)%15)/10};
    });
  }

  function statePower(){
    let p=.32;
    if(core.classList.contains('listening')) p=.55;
    if(document.body.classList.contains('thinking')) p=.82;
    if(core.classList.contains('awake')) p=1;
    return p;
  }

  function arcRing(radius, alpha, speed, segments, width){
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(phase*speed);
    ctx.lineWidth=width;
    ctx.strokeStyle='rgba(92,220,255,'+alpha+')';
    ctx.shadowColor='rgba(86,218,255,.65)';
    ctx.shadowBlur=8;
    for(let i=0;i<segments;i++){
      const a=(i/segments)*Math.PI*2;
      const span=(.08 + ((i*7)%5)*.012);
      ctx.beginPath();
      ctx.arc(0,0,radius,a,a+span);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(now){
    const dt=Math.min(40,now-last); last=now; phase+=dt*.001;
    const power=statePower(); pulse+=(power-pulse)*.05;
    ctx.clearRect(0,0,w,h);

    // soft volumetric field
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    const halo=ctx.createRadialGradient(cx,cy,15,cx,cy,360);
    halo.addColorStop(0,'rgba(164,246,255,'+(0.055+power*.045)+')');
    halo.addColorStop(.24,'rgba(54,202,247,'+(0.035+power*.028)+')');
    halo.addColorStop(.65,'rgba(25,118,158,.018)');
    halo.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=halo; ctx.fillRect(0,0,w,h);

    // orbital particles
    for(const p of particles){
      p.a += dt*p.spd*(1+power*.7);
      const wobble=Math.sin(phase*1.2+p.a*3)*8*p.z;
      const rr=p.r+wobble;
      const x=cx+Math.cos(p.a)*rr;
      const y=cy+Math.sin(p.a)*rr*.42;
      if(x<0||x>w||y<0||y>h) continue;
      const alpha=(.035+.11*p.z)*(.55+power*.75);
      ctx.fillStyle='rgba(116,228,255,'+alpha+')';
      ctx.shadowColor='rgba(73,211,255,.9)'; ctx.shadowBlur=5*p.z;
      ctx.beginPath(); ctx.arc(x,y,p.s*p.z,0,Math.PI*2); ctx.fill();
    }

    // cinematic rings around the core
    arcRing(98,.24+.18*power,.55,28,.7);
    arcRing(126,.14+.13*power,-.34,20,.55);
    arcRing(160,.08+.09*power,.19,16,.45);
    arcRing(214,.045+.055*power,-.10,12,.4);

    // scanner sweep
    ctx.save();
    ctx.translate(cx,cy);
    ctx.rotate(phase*.31);
    const beam=ctx.createLinearGradient(0,0,340,0);
    beam.addColorStop(0,'rgba(91,221,255,.16)');
    beam.addColorStop(.18,'rgba(91,221,255,.055)');
    beam.addColorStop(1,'rgba(91,221,255,0)');
    ctx.fillStyle=beam;
    ctx.beginPath(); ctx.moveTo(60,-1);ctx.lineTo(350,-18);ctx.lineTo(350,18);ctx.lineTo(60,1);ctx.closePath();ctx.fill();
    ctx.restore();

    // wake impulse
    if(core.classList.contains('awake')) awakeBurst=Math.min(1,awakeBurst+.08);
    else awakeBurst=Math.max(0,awakeBurst-.025);
    if(awakeBurst>0.01){
      const radius=105+awakeBurst*210;
      ctx.strokeStyle='rgba(173,245,255,'+(awakeBurst*.22)+')';
      ctx.lineWidth=1;
      ctx.shadowColor='rgba(91,221,255,.9)';ctx.shadowBlur=12;
      ctx.beginPath();ctx.arc(cx,cy,radius,0,Math.PI*2);ctx.stroke();
    }

    // subtle horizontal anamorphic flare
    const lg=ctx.createLinearGradient(cx-330,0,cx+330,0);
    lg.addColorStop(0,'rgba(70,205,248,0)');
    lg.addColorStop(.43,'rgba(70,205,248,'+(.015+power*.018)+')');
    lg.addColorStop(.5,'rgba(221,253,255,'+(.07+power*.06)+')');
    lg.addColorStop(.57,'rgba(70,205,248,'+(.015+power*.018)+')');
    lg.addColorStop(1,'rgba(70,205,248,0)');
    ctx.fillStyle=lg;ctx.fillRect(cx-330,cy-1,660,2);
    ctx.restore();
    requestAnimationFrame(draw);
  }

  const ro=new ResizeObserver(resize); ro.observe(stage);
  window.addEventListener('resize',resize,{passive:true});
  resize(); requestAnimationFrame(draw);
})();
