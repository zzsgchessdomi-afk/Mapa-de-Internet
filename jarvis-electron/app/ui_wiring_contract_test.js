const fs=require('fs');
const path=require('path');
const root=__dirname;
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'renderer.js'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
const duplicates=ids.filter((x,i)=>ids.indexOf(x)!==i);
if(duplicates.length) throw new Error('duplicate ids: '+[...new Set(duplicates)].join(','));
const idSet=new Set(ids);
const refs=[...js.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
const missing=[...new Set(refs.filter(x=>!idSet.has(x)))];
if(missing.length) throw new Error('renderer references missing DOM ids: '+missing.join(','));
const panels=[...html.matchAll(/data-panel="([^"]+)"/g)].map(m=>m[1]);
for(const p of panels) if(!idSet.has('panel-'+p)) throw new Error('missing panel target: '+p);
const buttonIds=[...html.matchAll(/<button[^>]*\bid="([^"]+)"[^>]*>/g)].map(m=>m[1]);
const generic=new Set(['winMin','winFull','winClose']);
for(const id of buttonIds){
  if(generic.has(id)) continue;
  if(!js.includes("$('"+id+"')") && !html.includes('id="'+id+'" data-op=') && !html.includes('id="'+id+'" data-panel=')){
    throw new Error('button has no renderer binding: '+id);
  }
}
if(/coming soon|mock|demo only/i.test(html)) throw new Error('placeholder language found');
console.log('UI_WIRING_CONTRACT=PASS');
