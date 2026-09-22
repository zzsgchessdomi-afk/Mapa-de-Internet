import fs from "node:fs/promises";
import assert from "node:assert/strict";

const html=await fs.readFile(new URL("../index.html",import.meta.url),"utf8");
const scripts=[];
for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)){
  const attrs=match[1]||"";
  if(/\bsrc\s*=/.test(attrs))continue;
  scripts.push(match[2]||"");
}

assert.ok(scripts.length>0,"index.html must contain inline scripts");
for(let i=0;i<scripts.length;i++){
  try{new Function(scripts[i])}
  catch(e){throw new Error(`index.html inline script #${i+1} failed to parse: ${e.message}`)}
}

assert.ok(html.includes('id="capsuleExport"'),"Capsule export button missing");
assert.ok(html.includes('id="capsuleOpen"'),"Capsule open button missing");
assert.ok(html.includes('id="capsuleCompare"'),"Capsule compare button missing");
assert.ok(html.includes("globalThis.__atlanexOpenedCapsule=capsule;"),"Opened capsule comparison state missing");
assert.equal(html.includes("\\nfunction renderSourceIntelligence(){"),false,"Literal \\n marker before renderSourceIntelligence");
assert.equal(html.includes("click();\\n$('capsuleCompare')"),false,"Literal \\n marker in capsule bindings");

console.log(JSON.stringify({ok:true,inlineScripts:scripts.length,capsuleUi:true}));
