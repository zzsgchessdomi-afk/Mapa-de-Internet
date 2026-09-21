import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const desktop=path.resolve(here,"..");
const root=path.resolve(desktop,"..");
const app=path.join(desktop,"app");

fs.rmSync(app,{recursive:true,force:true});
fs.mkdirSync(path.join(app,"api"),{recursive:true});
fs.mkdirSync(path.join(app,"lib"),{recursive:true});
fs.mkdirSync(path.join(app,"icons"),{recursive:true});

for(const rel of ["index.html","manifest.webmanifest","sw.js","THIRD_PARTY_NOTICES.md"]){
  fs.copyFileSync(path.join(root,rel),path.join(app,rel));
}
for(const rel of ["inspect.js","research.js"]){
  fs.copyFileSync(path.join(root,"api",rel),path.join(app,"api",rel));
}
fs.copyFileSync(path.join(root,"lib","scanner.js"),path.join(app,"lib","scanner.js"));

const icon="iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA7klEQVR4nO1WSQ7CMAykqBy5U/XeZ/EKntFX8CzuqM+AU1BVeZKZKSgUYamXJh6P7XhpDsfTY1dR9jWN/wl8BYHWUbrcJng2Dp2E1ShVkDPsEqFToBhX7hcjgIAiD5W7SeQ3kANLZ0q0shGYA6mPi9WHb0DNuUKGIjAXx3tWLyTAen+9T6+PkQi3GAHkxdIoIlGKgtWKkTE2EqsJvFO2SeDcx3lF/1cRQBWxNIaMlyoqbMXj0FGlqHocVQSVArcrMnqQgNv9VDx5HDPEFB15HCdwZR/ICb2SOeD2MHLBnPvSUpqk2lb8CdnmLPgpAk/iCGSamI/QYgAAAABJRU5ErkJggg==";
fs.writeFileSync(path.join(app,"icons","icon-192.png"),Buffer.from(icon,"base64"));
console.log("Prepared desktop/app from canonical root sources.");
