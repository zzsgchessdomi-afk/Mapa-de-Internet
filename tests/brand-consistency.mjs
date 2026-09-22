import fs from "node:fs/promises";
import assert from "node:assert/strict";

const read=async p=>await fs.readFile(new URL("../"+p,import.meta.url),"utf8");
const [desktopRaw,rootRaw,main,index,manifestRaw,windows,release]=await Promise.all([
  read("desktop/package.json"),
  read("package.json"),
  read("desktop/main.js"),
  read("index.html"),
  read("manifest.webmanifest"),
  read(".github/workflows/windows-build.yml"),
  read(".github/workflows/release.yml")
]);

const desktop=JSON.parse(desktopRaw),root=JSON.parse(rootRaw),manifest=JSON.parse(manifestRaw);
assert.equal(root.name,"atlanex");
assert.equal(desktop.name,"atlanex-desktop");
assert.equal(desktop.build.productName,"Atlanex");
assert.equal(desktop.build.appId,"com.atlanex.desktop");
assert.equal(desktop.build.nsis.shortcutName,"Atlanex");
assert.match(desktop.build.nsis.artifactName,/^Atlanex-Setup-/);
assert.match(desktop.build.portable.artifactName,/^Atlanex-Portable-/);
assert.equal(manifest.name,"Atlanex");
assert.equal(manifest.short_name,"Atlanex");
assert.ok(main.includes("app.setAppUserModelId('com.atlanex.desktop')"));
assert.ok(main.includes("tray.setToolTip('Atlanex')"));
for(const old of ["Internet Atlas — Autonomous Evidence Research","<b>Internet Atlas</b>","INTERNET ATLAS","Internet Atlas no pudo iniciar"]){
  assert.equal(index.includes(old),false,"legacy visible brand remains: "+old);
}
for(const wf of [windows,release]){
  assert.ok(wf.includes("Atlanex-Portable-*.exe"));
  assert.ok(wf.includes("Atlanex-Setup-*.exe"));
  assert.ok(wf.includes("'Atlanex.exe'"));
}
console.log(JSON.stringify({ok:true,product:"Atlanex",appId:desktop.build.appId}));
