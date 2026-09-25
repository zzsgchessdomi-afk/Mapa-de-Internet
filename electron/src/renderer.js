'use strict';

const state = { snapshot: null, selectedAction: null, busy: 0 };
const $ = (id) => document.getElementById(id);
const pretty = (x) => JSON.stringify(x, null, 2);

function toast(message, error = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = `toast${error ? ' error' : ''}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 4200);
}

function banner(message, error = false) {
  const el = $('banner');
  if (!message) { el.classList.add('hidden'); return; }
  el.textContent = message;
  el.style.borderColor = error ? 'rgba(255,95,114,.4)' : '';
  el.style.background = error ? 'rgba(100,20,30,.28)' : '';
  el.classList.remove('hidden');
}

async function call(op, payload = {}, opts = {}) {
  state.busy++;
  document.body.classList.toggle('busy', state.busy > 0);
  try {
    const response = await window.jarvis.request(op, payload);
    if (!response.ok) throw new Error(response.error || `Falló ${op}`);
    return response.result;
  } catch (err) {
    if (!opts.silent) toast(err.message, true);
    throw err;
  } finally {
    state.busy--;
    document.body.classList.toggle('busy', state.busy > 0);
  }
}

function setCoreBadge(data) {
  const badge = $('coreBadge');
  badge.className = `status-badge ${data.ready ? 'ready' : data.error ? 'error' : 'pending'}`;
  badge.querySelector('span:last-child').textContent = data.ready ? `Núcleo ${data.version || 'listo'}` : data.error ? 'Núcleo detenido' : 'Núcleo iniciando';
  if (data.error) banner(data.error, true);
}

function renderSnapshot(snap) {
  state.snapshot = snap;
  const modules = (snap.modules || []).filter(m => m.ready).length;
  const actions = (snap.actions || []).length;
  const perms = Object.values(snap.permissions || {}).filter(Boolean).length;
  $('statModules').textContent = modules;
  $('statActions').textContent = actions;
  $('statPermissions').textContent = perms;
  $('statProvider').textContent = snap.provider?.available ? 'ONLINE' : 'OFF';
  $('guardianLive').textContent = snap.permissions?.['guardian.enforce'] ? 'ENFORCED' : 'OFF';
  $('killLive').textContent = snap.kill_switch ? 'STOPPED' : 'ARMED';
  $('safeLive').textContent = snap.safe_mode ? 'ON' : 'OFF';
  $('versionLive').textContent = snap.version || '—';
  $('heroState').textContent = snap.kill_switch ? 'STOP GLOBAL ACTIVADO' : 'JARVIS está operativo';
  $('heroDetail').textContent = snap.kill_switch ? 'Las acciones están bloqueadas hasta que el propietario rearme JARVIS.' : `${modules} núcleos cargados · ${actions} acciones registradas · ${perms} permisos activos.`;
  document.querySelector('.orb')?.classList.toggle('stop', !!snap.kill_switch);
  $('providerMini').textContent = snap.provider?.available ? `${snap.provider.name} · ${snap.provider.model || 'modelo activo'} · disponible` : `${snap.provider?.name || 'Gemini'} · clave no configurada`;
  renderModules(snap.modules || []);
  renderPermissions(snap.permissions || {});
  renderActions(snap.actions || []);
  renderQuickActions(snap.actions || []);
}

function renderModules(modules) {
  const grid = $('moduleGrid');
  grid.innerHTML = '';
  for (const m of modules) {
    const div = document.createElement('div');
    div.className = `module-card${m.ready ? '' : ' not-ready'}`;
    div.innerHTML = `<div class="module-id">${escapeHtml(m.id)}</div><b>${escapeHtml(m.name)}</b><div class="ready-line">${m.ready ? '● CARGADO EN RUNTIME' : '● NO DISPONIBLE'}</div>`;
    grid.appendChild(div);
  }
}

function permissionCategory(key) {
  return key.split('.')[0].toUpperCase();
}
function renderPermissions(perms) {
  const grid = $('permissionGrid');
  grid.innerHTML = '';
  Object.keys(perms).sort().forEach((key) => {
    const row = document.createElement('div');
    row.className = 'perm';
    row.innerHTML = `<div><b>${escapeHtml(key)}</b><small>${permissionCategory(key)}</small></div><div class="switch ${perms[key] ? 'on' : ''}" data-cap="${escapeAttr(key)}" role="switch" aria-checked="${perms[key]}"></div>`;
    grid.appendChild(row);
  });
  grid.querySelectorAll('.switch').forEach(sw => sw.addEventListener('click', async () => {
    const cap = sw.dataset.cap;
    const next = !sw.classList.contains('on');
    try {
      await call('set_permission', { capability: cap, allowed: next });
      sw.classList.toggle('on', next);
      sw.setAttribute('aria-checked', String(next));
      if (state.snapshot) state.snapshot.permissions[cap] = next;
      toast(`${cap}: ${next ? 'ON' : 'OFF'}`);
    } catch (_) {}
  }));
}

function renderActions(actions) {
  const list = $('actionList');
  const query = ($('actionSearch')?.value || '').toLowerCase().trim();
  list.innerHTML = '';
  actions.filter(a => !query || a.name.toLowerCase().includes(query) || a.capability.toLowerCase().includes(query)).forEach(a => {
    const row = document.createElement('div');
    row.className = `action-row${state.selectedAction?.name === a.name ? ' selected' : ''}`;
    row.innerHTML = `<b>${escapeHtml(a.name)}</b><small>${escapeHtml(a.capability)}</small>`;
    row.addEventListener('click', () => selectAction(a));
    list.appendChild(row);
  });
}

function selectAction(action) {
  state.selectedAction = action;
  $('selectedAction').textContent = action.name;
  $('selectedCapability').textContent = action.capability;
  $('runAction').disabled = false;
  renderActions(state.snapshot?.actions || []);
}

function prefixActions(actions, prefixes) {
  return actions.filter(a => prefixes.some(p => a.name.startsWith(p)));
}
function quickButtons(targetId, actions) {
  const target = $(targetId); if (!target) return;
  target.innerHTML = '';
  actions.forEach(a => {
    const b = document.createElement('button');
    b.className = 'quick-action'; b.textContent = a.name;
    b.title = a.capability;
    b.addEventListener('click', () => { selectAction(a); showView('actions'); $('actionArgs').focus(); });
    target.appendChild(b);
  });
}
function renderQuickActions(actions) {
  quickButtons('mobileActions', prefixActions(actions, ['mobile_']));
  quickButtons('realityActions', prefixActions(actions, ['reality_']));
  quickButtons('workbenchActions', prefixActions(actions, ['workbench_', 'autonomy_']));
  quickButtons('swarmActions', prefixActions(actions, ['swarm_']));
  quickButtons('evolutionActions', prefixActions(actions, ['evolution_']));
  quickButtons('researchSkillActions', prefixActions(actions, ['research_', 'deep_', 'skill_', 'learn_', 'run_mission']));
}

function escapeHtml(s) { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function escapeAttr(s) { return escapeHtml(s); }

function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  const titles = {dashboard:'Centro de mando',command:'Comandos',modules:'Núcleos Infinity',permissions:'Autoridad del propietario',actions:'Registro de acciones',devices:'Móvil & Reality',autonomy:'Autonomía',diagnostics:'Diagnóstico',owner:'Propietario'};
  $('viewTitle').textContent = titles[view] || 'JARVIS GM';
}

async function refreshSnapshot() {
  try {
    const s = await call('snapshot', {}, { silent: true });
    renderSnapshot(s);
    setCoreBadge({ ready: !!s.ready, version: s.version });
    banner('');
  } catch (err) {
    setCoreBadge({ ready: false, error: err.message });
  }
}

function addMessage(kind, title, content) {
  const wrap = document.createElement('div');
  wrap.className = `message ${kind}`;
  const pre = typeof content === 'string' ? content : pretty(content);
  wrap.innerHTML = `<b>${escapeHtml(title)}</b><p>${escapeHtml(pre)}</p>`;
  $('conversation').appendChild(wrap);
  $('conversation').scrollTop = $('conversation').scrollHeight;
}

async function runCommand() {
  const text = $('commandInput').value.trim(); if (!text) return;
  $('commandInput').value = '';
  addMessage('user', 'TÚ', text);
  const btn = $('sendCommand'); btn.disabled = true; btn.textContent = 'EJECUTANDO…';
  try {
    const goal = await call('command', { text });
    addMessage(goal.state === 'verified' ? 'assistant' : 'error', 'JARVIS', { state: goal.state, verification: goal.verification, results: goal.results });
  } catch (err) { addMessage('error', 'JARVIS', err.message); }
  finally { btn.disabled = false; btn.textContent = 'EJECUTAR MISIÓN'; }
}

async function runSelectedAction() {
  if (!state.selectedAction) return;
  let args;
  try { args = JSON.parse($('actionArgs').value || '{}'); } catch (err) { return toast(`JSON inválido: ${err.message}`, true); }
  const btn = $('runAction'); btn.disabled = true; btn.textContent = 'EJECUTANDO…';
  try {
    const result = await call('invoke', { name: state.selectedAction.name, args });
    $('actionOutput').textContent = pretty(result);
    toast(`${state.selectedAction.name}: ${result.verified ? 'verificada' : 'terminó sin verificación'}`);
  } catch (err) { $('actionOutput').textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = 'EJECUTAR POR GUARDIAN'; }
}

async function refreshAcceptance() {
  try {
    const report = await call('acceptance_report');
    const grid = $('acceptanceGrid'); grid.innerHTML = '';
    for (const [name, item] of Object.entries(report.checks || {})) {
      const row = document.createElement('div'); row.className = 'acceptance-item';
      row.innerHTML = `<b>${escapeHtml(name)}</b><span class="chip muted">${escapeHtml(item.status)}</span><select><option value="pending">pending</option><option value="passed">passed</option><option value="failed">failed</option><option value="not_applicable">not_applicable</option></select>`;
      const sel = row.querySelector('select'); sel.value = item.status;
      sel.addEventListener('change', async () => { try { await call('acceptance_set', { name, status: sel.value, note: 'Set by owner in Electron UI' }); toast(`${name}: ${sel.value}`); refreshAcceptance(); } catch (_) {} });
      grid.appendChild(row);
    }
  } catch (_) {}
}

function wire() {
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
  $('stopBtn').addEventListener('click', async () => { try { await call('stop'); toast('STOP GLOBAL activado'); refreshSnapshot(); } catch (_) {} });
  $('rearmBtn').addEventListener('click', async () => { try { await call('rearm'); toast('JARVIS rearmado por el propietario'); refreshSnapshot(); } catch (_) {} });
  $('restartCore').addEventListener('click', async () => { await window.jarvis.restartCore(); toast('Reiniciando núcleo interno…'); });
  $('refreshSnapshot').addEventListener('click', refreshSnapshot);
  $('refreshModules').addEventListener('click', refreshSnapshot);
  $('refreshPermissions').addEventListener('click', refreshSnapshot);
  $('startPerception').addEventListener('click', async () => { try { const r=await call('start_perception'); toast('Voz + gestos activados'); $('worldPreview').textContent=pretty(r); } catch (_) {} });
  $('voiceGestureOn').addEventListener('click', async () => { try { await call('start_perception'); toast('Perception Bridge activo'); } catch (_) {} });
  $('startSentinel').addEventListener('click', async () => { try { await call('start_sentinel'); toast('Sentinel activo'); } catch (_) {} });
  $('sentinelOn').addEventListener('click', async () => { try { await call('start_sentinel'); toast('Sentinel activo'); } catch (_) {} });
  $('perceptionOff').addEventListener('click', async () => { try { await call('stop_perception'); toast('Percepción detenida'); } catch (_) {} });
  $('sendCommand').addEventListener('click', runCommand);
  $('commandInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runCommand(); } });
  $('actionSearch').addEventListener('input', () => renderActions(state.snapshot?.actions || []));
  $('runAction').addEventListener('click', runSelectedAction);
  document.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', async () => { try { const r=await call(b.dataset.op); const map={world_stats:'worldPreview',workbench_stats:'workbenchPreview',reality_status:'realityPreview'}; $(map[b.dataset.op]).textContent=pretty(r); } catch (_) {} }));
  $('mobileRefresh').addEventListener('click', async () => { try { $('mobileOutput').textContent=pretty(await call('mobile_summary')); } catch (_) {} });
  $('realityRefresh').addEventListener('click', async () => { try { $('realityOutput').textContent=pretty(await call('reality_status')); } catch (_) {} });
  document.querySelectorAll('[data-autonomy-stat]').forEach(b => b.addEventListener('click', async () => { const op=b.dataset.autonomyStat; const map={workbench_stats:'autonomyWorkbench',swarm_stats:'autonomySwarm',evolution_stats:'autonomyEvolution'}; try { $(map[op]).textContent=pretty(await call(op)); } catch (_) {} }));
  $('runDiagnostics').addEventListener('click', async () => { try { const d=await call('diagnostics'); $('diagnosticsOutput').textContent=pretty(d); $('diagSummary').innerHTML=`<span class="diag-pill ${d.kill_switch?.engaged?'warn':'ok'}">Kill switch: ${d.kill_switch?.engaged?'STOP':'armed'}</span><span class="diag-pill ${d.provider?.available?'ok':'warn'}">Provider: ${d.provider?.available?'online':'offline'}</span><span class="diag-pill ${d.release_gate?.status==='release-ready'?'ok':'warn'}">Gate: ${escapeHtml(d.release_gate?.status || 'unknown')}</span>`; } catch (_) {} });
  $('runSelfTest').addEventListener('click', async () => { try { const r=await call('self_test'); $('diagnosticsOutput').textContent=pretty(r); $('diagSummary').innerHTML=`<span class="diag-pill ${r.ok?'ok':'warn'}">Self-test: ${r.ok?'PASS':'FAIL'}</span><span class="diag-pill">Checks: ${r.count}</span>`; } catch (_) {} });
  $('saveProvider').addEventListener('click', async () => { try { const r=await call('provider_config',{api_key:$('geminiKey').value.trim(),model:$('geminiModel').value.trim()}); $('geminiKey').value=''; $('providerOutput').textContent=pretty(r); toast('Configuración IA guardada en Windows'); refreshSnapshot(); } catch (_) {} });
  $('clearProvider').addEventListener('click', async () => { try { $('providerOutput').textContent=pretty(await call('provider_clear_key')); toast('Clave eliminada'); refreshSnapshot(); } catch (_) {} });
  $('createBackup').addEventListener('click', async () => { const dest=await window.jarvis.pickSave({title:'Guardar backup JARVIS',defaultPath:'JARVIS_GM_Backup.jarvisbackup',filters:[{name:'JARVIS Backup',extensions:['jarvisbackup']}]}); if(!dest)return; try{$('backupOutput').textContent=pretty(await call('backup_create',{destination:dest}));toast('Backup creado');}catch(_){} });
  $('validateBackup').addEventListener('click', async () => { const p=await window.jarvis.pickOpen({title:'Validar backup JARVIS',properties:['openFile'],filters:[{name:'JARVIS Backup',extensions:['jarvisbackup']}]}); if(!p.length)return; try{$('backupOutput').textContent=pretty(await call('backup_validate',{source:p[0]}));}catch(_){} });
  $('stageRestore').addEventListener('click', async () => { const p=await window.jarvis.pickOpen({title:'Preparar restauración JARVIS',properties:['openFile'],filters:[{name:'JARVIS Backup',extensions:['jarvisbackup']}]}); if(!p.length)return; try{$('backupOutput').textContent=pretty(await call('backup_stage_restore',{source:p[0]}));toast('Restore validado; se aplicará al reiniciar JARVIS');}catch(_){} });
  $('refreshAcceptance').addEventListener('click', refreshAcceptance);
  $('releaseGate').addEventListener('click', async () => { try{$('releaseOutput').textContent=pretty(await call('release_gate'));}catch(_){} });
  $('exportAndroid').addEventListener('click', async () => { try { const p=await window.jarvis.exportBundled('android'); if(p) toast('Companion Android exportado'); } catch(err) { toast(err.message,true); } });
  $('exportSource').addEventListener('click', async () => { try { const p=await window.jarvis.exportBundled('source'); if(p) toast('Código fuente completo exportado'); } catch(err) { toast(err.message,true); } });
  $('openUserData').addEventListener('click', () => window.jarvis.openUserData());
}

async function boot() {
  wire();
  window.jarvis.onCoreStatus((s) => { setCoreBadge(s); if (s.ready) setTimeout(async () => { try { const bootState=await call('boot',{}, {silent:true}); renderSnapshot(bootState); banner(''); refreshAcceptance(); } catch (err) { banner(err.message,true); } }, 150); });
  try {
    const ping = await call('ping', {}, { silent: true });
    setCoreBadge({ ready: true, version: ping.version });
    const bootState = await call('boot', {}, { silent: true });
    renderSnapshot(bootState);
    refreshAcceptance();
  } catch (err) {
    banner(`El núcleo interno todavía no está listo: ${err.message}`, true);
  }
}

boot();