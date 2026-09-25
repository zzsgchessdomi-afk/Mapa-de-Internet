const fs=require('fs');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const css=fs.readFileSync(__dirname+'/styles.css','utf8');
const js=fs.readFileSync(__dirname+'/renderer.js','utf8');
for(const t of ['gestureLayer','gestureCursor','gestureLabel']) if(!html.includes(t)) throw new Error('missing '+t);
for(const t of ['handlePerceptionUi','gesture.armed','gesture.transform','intent.execution_result']) if(!js.includes(t)) throw new Error('missing '+t);
for(const t of ['.gesture-layer','.gesture-cursor','body[data-mode="gesture"]']) if(!css.includes(t)) throw new Error('missing '+t);
console.log('GESTURE_HUD_CONTRACT=PASS');
