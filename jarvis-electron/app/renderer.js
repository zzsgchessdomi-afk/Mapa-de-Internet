const $=id=>document.getElementById(id);
const fmt=v=>typeof v==='string'?v:JSON.stringify(v,null,2);
let status=null,busyCount=0,pendingPermission=null,lastVoiceDetail='';

function busy(on){busyCount=Math.max(0,busyCount+(on?1:-1));document.body.classList.toggle('busy',busyCount>0);}
async function call(op,args={},outputId=null){
  busy(true);
  try{const result=await window.jarvis.invoke(op,args);if(outputId&&$(outputId))$(outputId).textContent=fmt(result);return result;}
  catch(err){if(outputId&&$(outputId))$(outputId).textContent='ERROR: '+err.message;throw err;}
  finally{busy(false);}
}
function setMode(mode,label=null){
  document.body.dataset.mode=mode;
  const map={boot:'INITIALIZING',idle:'SYSTEM READY',listening:'LISTENING',awake:'LISTENING',processing:'PROCESSING',auth:'AUTHORIZATION',stopped:'STOPPED','voice-offline':'VOICE OFFLINE',error:'CORE ERROR'};
  $('wakeHint').textContent=label||map[mode]||'SYSTEM READY';
}
function safeHud(text,fallback='SYSTEM READY'){
  const s=String(text||fallback).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  if(/traceback|win32com|gen_py|exception|error:|0x[0-9a-f]+/i.test(s))return fallback;
  return s.slice(0,110).toUpperCase();
}
function setHudMessage(role,text){
  if(role==='user'){
    $('lastInput').textContent=safeHud(text,'COMMAND RECEIVED');
    setMode('processing');
  }else{
    $('lastResponse').textContent=safeHud(text,'SYSTEM READY');
    if(document.body.dataset.mode==='processing')setMode(status?.perception?.voice?.running?'listening':'idle');
  }
}
function renderPermissions(perms){
  const root=$('permissionsGrid');root.innerHTML='';
  Object.entries(perms).sort(([a],[b])=>a.localeCompare(b)).forEach(([cap,allowed])=>{
    const row=document.createElement('div');row.className='perm';
    const label=document.createElement('span');label.textContent=cap;
    const input=document.createElement('input');input.type='checkbox';input.className='switch';input.checked=!!allowed;
    input.addEventListener('change',async()=>{input.disabled=true;try{await call('set_permission',{capability:cap,allowed:input.checked});await refreshStatus();}catch(_){input.checked=!input.checked}finally{input.disabled=false}});
    row.append(label,input);root.appendChild(row);
  });
}
function renderStatus(s){
  status=s;const p=s.perception||{},voice=p.voice||{};
  const items=[['CORE',s.mode||'Infinity 7'],['STOP',s.stop_engaged?'LOCK':'READY'],['VOICE',voice.running?'ON':'OFF'],['VISION',p.vision?.running?'ON':'OFF'],['WORK',String(s.workbench?.total??0)],['WORLD',String(s.world?.entities??0)]];
  $('statusStrip').innerHTML=items.map(([a,b])=>`<div class="status-chip"><b>${a}</b><span>${b}</span></div>`).join('');
  $('stopBtn').classList.toggle('engaged',!!s.stop_engaged);
  $('resetStop').classList.toggle('hidden',!s.stop_engaged);
  renderPermissions(s.permissions||{});
  if($('perceptionOutput'))$('perceptionOutput').textContent=fmt(p);

  if(s.stop_engaged){$('voiceBadge').textContent='STOPPED';setMode('stopped');return;}
  if(voice.running){$('voiceBadge').textContent='ONLINE';$('voiceBadge').classList.remove('bad');$('presenceOrb').classList.add('listening');if(!['awake','processing','auth'].includes(document.body.dataset.mode))setMode('listening');}
  else if(voice.status==='error'||voice.status==='unavailable'){$('voiceBadge').textContent='VOICE OFFLINE';$('voiceBadge').classList.add('bad');$('presenceOrb').classList.remove('listening');setMode('voice-offline');}
  else{$('voiceBadge').textContent='STARTING';$('presenceOrb').classList.remove('listening');if(document.body.dataset.mode==='boot')setMode('boot');}
}
async function refreshStatus(){try{renderStatus(await call('status'));}catch(_){$('voiceBadge').textContent='CORE OFFLINE';setMode('error');}}
function showCommandResult(result){
  setHudMessage('jarvis',result.message||'ORDER COMPLETE');
  $('goalOutput').textContent=result.message||'';
  if(result.needs_permission&&result.capability){
    pendingPermission={text:result.text,capability:result.capability};
    $('permissionTitle').textContent='AUTHORIZATION REQUIRED';
    $('permissionText').textContent=`Permission required: ${result.capability_label||result.capability}`;
    $('permissionBar').classList.remove('hidden');setMode('auth');
  }else{pendingPermission=null;$('permissionBar').classList.add('hidden');}
}
async function executeGoal(text,authorizedMode=null){
  if(!text)return;setHudMessage('user',text);$('goalOutput').textContent='Working…';$('runGoal').disabled=true;
  try{const result=authorizedMode?await call('run_goal_authorized',{text,capability:pendingPermission.capability,mode:authorizedMode}):await call('run_goal',{text});showCommandResult(result);if(result.state==='verified')$('goalInput').value='';}
  catch(err){$('goalOutput').textContent='ERROR: '+err.message;$('lastResponse').textContent='COMMAND FAILED';setMode(status?.perception?.voice?.running?'listening':'idle');}
  finally{$('runGoal').disabled=false;await refreshStatus();}
}

document.querySelectorAll('[data-op]').forEach(btn=>btn.addEventListener('click',async()=>{try{const r=await call(btn.dataset.op);$('perceptionOutput').textContent=fmt(r);await refreshStatus();}catch(_){} }));
$('runGoal').addEventListener('click',()=>executeGoal($('goalInput').value.trim()));
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
$('saveProvider').addEventListener('click',async()=>{await call('provider_set',{model:$('modelInput').value,api_key:$('apiKeyInput').value},'settingsOutput');$('apiKeyInput').value='';await refreshStatus();});
$('selfTest').addEventListener('click',()=>call('self_test',{},'settingsOutput'));
$('diagnostics').addEventListener('click',async()=>{const r=await call('diagnostics',{},'settingsOutput');if(lastVoiceDetail)$('settingsOutput').textContent+='\n\nVOICE DETAIL\n'+lastVoiceDetail;return r;});
$('releaseGate').addEventListener('click',()=>call('release_gate',{},'settingsOutput'));
$('openLog').addEventListener('click',()=>window.jarvis.openLog());

$('allowOnce').addEventListener('click',async()=>{if(!pendingPermission)return;const p={...pendingPermission};$('permissionBar').classList.add('hidden');if(p.source==='voice'){await call('voice_permission',{mode:'once'});pendingPermission=null;}else{pendingPermission=p;await executeGoal(p.text,'once');}});
$('allowAlways').addEventListener('click',async()=>{if(!pendingPermission)return;const p={...pendingPermission};$('permissionBar').classList.add('hidden');if(p.source==='voice'){await call('voice_permission',{mode:'always'});pendingPermission=null;}else{pendingPermission=p;await executeGoal(p.text,'always');}});
$('denyPermission').addEventListener('click',async()=>{const p=pendingPermission;pendingPermission=null;$('permissionBar').classList.add('hidden');if(p?.source==='voice')await call('voice_permission',{mode:'cancel'});setHudMessage('jarvis','CANCELLED');await refreshStatus();});

function showPanel(key){
  document.querySelectorAll('.dock-btn').forEach(x=>x.classList.toggle('active',x.dataset.panel===key));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  const target=$('panel-'+key);if(target)target.classList.add('active');
}
document.querySelectorAll('[data-panel]').forEach(btn=>btn.addEventListener('click',()=>showPanel(btn.dataset.panel)));
$('winMin').addEventListener('click',()=>window.jarvis.window('minimize'));
$('winFull').addEventListener('click',()=>window.jarvis.window('fullscreen'));
$('winClose').addEventListener('click',()=>window.jarvis.window('close'));
$('presenceOrb').addEventListener('click',async()=>{try{if(!status?.perception?.voice?.running){setMode('boot','VOICE STARTING');await call('voice_start');setTimeout(refreshStatus,700);}else await call('speak',{text:'Sí, aquí estoy.'});}catch(_){setMode('voice-offline');}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')showPanel('command');if(e.key==='F11'){e.preventDefault();window.jarvis.window('fullscreen');}if((e.ctrlKey||e.metaKey)&&e.code==='Space'){e.preventDefault();const f=document.querySelector('.text-fallback');f.open=!f.open;if(f.open)$('goalInput').focus();}});

window.jarvis.onEvent(evt=>{
  if(evt.event==='ready')refreshStatus();
  if(evt.event==='voice-status'){
    lastVoiceDetail=String(evt.detail||'');
    const ok=evt.status==='running';
    $('voiceBadge').textContent=ok?'ONLINE':(evt.status==='error'||evt.status==='unavailable'?'VOICE OFFLINE':'STARTING');
    $('presenceOrb').classList.toggle('listening',ok);
    if(ok){$('voiceBadge').classList.remove('bad');setMode('listening');$('lastResponse').textContent='SYSTEM READY';}
    else if(evt.status==='error'||evt.status==='unavailable'){$('voiceBadge').classList.add('bad');setMode('voice-offline');$('lastResponse').textContent='VOICE ENGINE UNAVAILABLE';if($('perceptionOutput'))$('perceptionOutput').textContent='VOICE DETAIL\n'+lastVoiceDetail;}
    else setMode('boot','VOICE STARTING');
  }
  if(evt.event==='voice-wake'){$('presenceOrb').classList.add('awake');setMode('awake');$('lastResponse').textContent='YES?';setTimeout(()=>{$('presenceOrb').classList.remove('awake');if(document.body.dataset.mode==='awake')setMode('listening');},2200);}
  if(evt.event==='voice-command'){setHudMessage('user',evt.text);setMode('processing');}
  if(evt.event==='assistant'&&evt.text){setHudMessage('jarvis',evt.text);setMode(status?.perception?.voice?.running?'listening':'idle');}
  if(evt.event==='voice-permission'){pendingPermission={source:'voice',text:evt.text,capability:evt.capability};$('permissionTitle').textContent='AUTHORIZATION REQUIRED';$('permissionText').textContent=evt.capability_label||evt.capability;$('permissionBar').classList.remove('hidden');setMode('auth');}
  if(evt.event==='voice-permission-cleared'){if(pendingPermission?.source==='voice')pendingPermission=null;$('permissionBar').classList.add('hidden');refreshStatus();}
  if(evt.event==='fatal'||evt.event==='backend-exit'){$('voiceBadge').textContent='CORE OFFLINE';$('goalOutput').textContent=String(evt.error||evt.code||'backend stopped');$('lastResponse').textContent='CORE OFFLINE';setMode('error');}
});

(async()=>{setMode('boot');const state=await window.jarvis.state();if(state.ready)await refreshStatus();else setTimeout(refreshStatus,1000);try{const p=await call('provider_get');$('modelInput').value=p.model||$('modelInput').value;}catch(_){}})();

/* Reference-mode cinematic renderer. No external assets. */
(()=>{
  const canvas=$('cinematicCanvas'),stage=document.querySelector('.hud-stage'),core=$('presenceOrb');
  if(!canvas||!stage||!core)return;
  const ctx=canvas.getContext('2d',{alpha:true});
  let w=1,h=1,dpr=1,cx=0,cy=0,last=performance.now(),phase=0,mx=0,my=0,tx=0,ty=0,particles=[];
  function resize(){const r=stage.getBoundingClientRect();dpr=Math.max(1,Math.min(2,devicePixelRatio||1));w=r.width;h=r.height;canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);const cr=core.getBoundingClientRect();cx=cr.left-r.left+cr.width/2;cy=cr.top-r.top+cr.height/2;seed();}
  function seed(){const n=Math.max(45,Math.min(90,Math.floor(w*h/23000)));particles=Array.from({length:n},(_,i)=>({a:i/n*Math.PI*2,r:115+(i*73)%330,s:.25+(i*17)%9/10,z:.18+(i*31)%70/100,v:(i%2?1:-1)*(.000025+(i%11)*.000004)}));}
  function modePower(){const m=document.body.dataset.mode;return m==='awake'?1:m==='processing'?.92:m==='listening'?.58:m==='auth'?.72:m==='voice-offline'?.18:.30;}
  function ring(radius,alpha,speed,count,width){ctx.save();ctx.translate(cx+mx,cy+my);ctx.rotate(phase*speed);ctx.strokeStyle=`rgba(104,222,255,${alpha})`;ctx.lineWidth=width;ctx.shadowColor='rgba(78,210,250,.55)';ctx.shadowBlur=6;for(let i=0;i<count;i++){const a=i/count*Math.PI*2,span=.035+((i*7)%5)*.012;ctx.beginPath();ctx.arc(0,0,radius,a,a+span);ctx.stroke();}ctx.restore();}
  function draw(now){const dt=Math.min(40,now-last);last=now;phase+=dt*.001;mx+=(tx-mx)*.025;my+=(ty-my)*.025;const p=modePower();ctx.clearRect(0,0,w,h);ctx.save();ctx.globalCompositeOperation='lighter';
    const glow=ctx.createRadialGradient(cx+mx,cy+my,6,cx+mx,cy+my,285);glow.addColorStop(0,`rgba(192,249,255,${.028+p*.035})`);glow.addColorStop(.20,`rgba(65,207,248,${.018+p*.020})`);glow.addColorStop(.62,'rgba(27,111,147,.008)');glow.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
    for(const q of particles){q.a+=dt*q.v*(1+p*.55);const rr=q.r+Math.sin(phase*.7+q.a*4)*4*q.z,x=cx+mx+Math.cos(q.a)*rr,y=cy+my+Math.sin(q.a)*rr*.38;if(x<0||x>w||y<0||y>h)continue;ctx.fillStyle=`rgba(112,222,250,${(.018+.055*q.z)*(1+p*.6)})`;ctx.beginPath();ctx.arc(x,y,q.s*q.z,0,Math.PI*2);ctx.fill();}
    ring(73,.20+p*.15,.48,22,.55);ring(92,.10+p*.10,-.25,18,.45);ring(118,.055+p*.07,.13,14,.4);ring(168,.025+p*.035,-.07,10,.35);
    ctx.save();ctx.translate(cx+mx,cy+my);ctx.rotate(phase*.18);const beam=ctx.createLinearGradient(52,0,285,0);beam.addColorStop(0,`rgba(91,218,251,${.045+p*.06})`);beam.addColorStop(.22,'rgba(91,218,251,.022)');beam.addColorStop(1,'rgba(91,218,251,0)');ctx.fillStyle=beam;ctx.beginPath();ctx.moveTo(48,-.5);ctx.lineTo(285,-8);ctx.lineTo(285,8);ctx.lineTo(48,.5);ctx.closePath();ctx.fill();ctx.restore();
    const flare=ctx.createLinearGradient(cx-240,0,cx+240,0);flare.addColorStop(0,'rgba(80,210,247,0)');flare.addColorStop(.48,'rgba(102,225,255,.012)');flare.addColorStop(.5,`rgba(224,253,255,${.03+p*.03})`);flare.addColorStop(.52,'rgba(102,225,255,.012)');flare.addColorStop(1,'rgba(80,210,247,0)');ctx.fillStyle=flare;ctx.fillRect(cx-240,cy-1,480,2);ctx.restore();requestAnimationFrame(draw);}
  stage.addEventListener('pointermove',e=>{const r=stage.getBoundingClientRect();tx=(e.clientX-r.left-r.width/2)*.0035;ty=(e.clientY-r.top-r.height/2)*.0035;},{passive:true});stage.addEventListener('pointerleave',()=>{tx=0;ty=0;});
  new ResizeObserver(resize).observe(stage);resize();requestAnimationFrame(draw);
})();
