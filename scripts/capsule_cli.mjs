import "../lib/capsule-core.js";
import fs from "node:fs/promises";
import path from "node:path";

const [command,file,otherFile]=process.argv.slice(2);
if(!command||!file){
  console.error("Usage: node scripts/capsule_cli.mjs <verify|summary> <file.aicapsule> OR compare <left.aicapsule> <right.aicapsule>");
  process.exit(2);
}
const absolute=path.resolve(file);
let capsule;
try{capsule=JSON.parse(await fs.readFile(absolute,"utf8"))}
catch(e){console.error("Unable to read capsule:",e.message);process.exit(2)}

if(command==="compare"){
  if(!otherFile){console.error("compare requires two capsule files");process.exit(2)}
  let other;
  try{other=JSON.parse(await fs.readFile(path.resolve(otherFile),"utf8"))}
  catch(e){console.error("Unable to read second capsule:",e.message);process.exit(2)}
  const [leftCheck,rightCheck]=await Promise.all([
    globalThis.AtlanexCapsule.verifyCapsule(capsule),
    globalThis.AtlanexCapsule.verifyCapsule(other)
  ]);
  if(!leftCheck.ok||!rightCheck.ok){
    console.error(JSON.stringify({left:leftCheck,right:rightCheck},null,2));process.exit(1)
  }
  console.log(JSON.stringify(globalThis.AtlanexCapsule.compareCapsules(capsule,other),null,2));
  process.exit(0);
}
if(command==="verify"){
  const result=await globalThis.AtlanexCapsule.verifyCapsule(capsule);
  console.log(JSON.stringify(result,null,2));
  process.exit(result.ok?0:1);
}
if(command==="summary"){
  console.log(JSON.stringify(globalThis.AtlanexCapsule.summary(capsule),null,2));
  process.exit(0);
}
console.error("Unknown command:",command);
process.exit(2);
