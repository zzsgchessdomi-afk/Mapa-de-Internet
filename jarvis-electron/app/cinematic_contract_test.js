const fs=require('fs');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const css=fs.readFileSync(__dirname+'/styles.css','utf8');
const js=fs.readFileSync(__dirname+'/renderer.js','utf8');
for(const token of ['cinematicCanvas','presenceOrb','Autonomous Workbench','MISSION AUTOPILOT','Cognitive Swarm','PERSONAL AI OS','Reality Bridge','Guardian']) if(!html.includes(token)) throw new Error('missing '+token);
for(const token of ['frame:false','setFullScreen(true)']) {
  const main=fs.readFileSync(__dirname+'/main.js','utf8'); if(!main.includes(token)) throw new Error('missing '+token);
}
if(/chat-msg|chat-role|chat-text|conversation-feed/.test(html)) throw new Error('chat surface returned');
if(js.includes("VOICE ERROR // ${evt.detail")) throw new Error('raw voice exception leaks into main HUD');
if(!js.includes("safeHud(")) throw new Error('HUD sanitization missing');
if(!css.includes('.core{position:relative;width:92px')) throw new Error('reference core scale drift');
console.log('REFERENCE_MODE_CONTRACT=PASS');
