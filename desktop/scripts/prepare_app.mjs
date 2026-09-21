import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const desktop=path.resolve(here,"..");
const root=path.resolve(desktop,"..");
const app=path.join(desktop,"app");

fs.rmSync(app,{recursive:true,force:true});
fs.mkdirSync(path.join(app,"api"),{recursive:true});
fs.mkdirSync(path.join(app,"lib"),{recursive:true});

for(const rel of ["index.html","manifest.webmanifest","sw.js","THIRD_PARTY_NOTICES.md"]){
  fs.copyFileSync(path.join(root,rel),path.join(app,rel));
}
for(const rel of ["inspect.js","research.js"]){
  fs.copyFileSync(path.join(root,"api",rel),path.join(app,"api",rel));
}
fs.copyFileSync(path.join(root,"lib","scanner.js"),path.join(app,"lib","scanner.js"));
console.log("Prepared desktop/app from canonical root sources.");