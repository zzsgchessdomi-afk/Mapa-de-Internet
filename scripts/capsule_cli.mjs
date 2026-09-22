import "../lib/capsule-core.js";
import fs from "node:fs/promises";
import path from "node:path";

const [command,file]=process.argv.slice(2);
if(!command||!file){
  console.error("Usage: node scripts/capsule_cli.mjs <verify|summary> <file.aicapsule>");
  process.exit(2);
}
const absolute=path.resolve(file);
let capsule;
try{capsule=JSON.parse(await fs.readFile(absolute,"utf8"))}
catch(e){console.error("Unable to read capsule:",e.message);process.exit(2)}

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
