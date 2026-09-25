const fs=require('fs');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const css=fs.readFileSync(__dirname+'/styles.css','utf8');
const js=fs.readFileSync(__dirname+'/renderer.js','utf8');
const must=[
  [html,'cinematicCanvas'],[html,'reference-core'],[html,'permissionBar'],
  [css,'CINEMATIC CORE LAYER'],[css,'reactor-haze'],[css,'lens-flare'],
  [js,'Cinematic JARVIS visualization'],[js,'requestAnimationFrame(draw)'],[js,'ResizeObserver']
];
for(const [src,token] of must){if(!src.includes(token))throw new Error('missing visual contract: '+token);}
if(/chat-msg|chat-role|chat-text/.test(html)) throw new Error('chat surface returned to main HTML');
console.log('CINEMATIC_VISUAL_CONTRACT=PASS');
