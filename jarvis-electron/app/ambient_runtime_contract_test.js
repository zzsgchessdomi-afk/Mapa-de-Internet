const fs=require('fs');
const m=fs.readFileSync(__dirname+'/main.js','utf8');
for(const t of ['requestSingleInstanceLock','CommandOrControl+Shift+J','CommandOrControl+Shift+Space','globalShortcut.unregisterAll']) if(!m.includes(t)) throw new Error('missing '+t);
console.log('AMBIENT_RUNTIME_CONTRACT=PASS');
