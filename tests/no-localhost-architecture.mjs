import fs from "node:fs/promises";
import assert from "node:assert/strict";

const read=async p=>await fs.readFile(new URL("../"+p,import.meta.url),"utf8");
const [main,preload,sidecar,index,spec,installer]=await Promise.all([
  read("desktop/main.js"),
  read("desktop/preload.cjs"),
  read("desktop/sidecar/server.py"),
  read("index.html"),
  read("desktop/sidecar/atlas_agent.spec"),
  read("desktop/scripts/install_agent_dependencies.py")
]);

const transport=[main,preload,sidecar].join("\n");
for(const forbidden of ["127.0.0.1","localhost"]){
  assert.equal(transport.includes(forbidden),false,`forbidden loopback marker remains: ${forbidden}`);
}
assert.equal(/from ['"]node:http['"]/.test(main),false,"desktop host must not import node:http");
assert.equal(/from ['"]node:net['"]/.test(main),false,"desktop host must not import node:net");
for(const forbidden of ["startServer","serverPort","sidecarPort","freePort("])assert.equal(main.includes(forbidden),false,`legacy server symbol remains: ${forbidden}`);
assert.ok(main.includes("loadFile(path.join(appDir,'index.html'))"),"renderer must load from packaged file");
assert.ok(main.includes("ipcMain.handle('atlas:research'"),"research IPC missing");
assert.ok(main.includes("ipcMain.handle('atlas:inspect'"),"inspection IPC missing");
assert.ok(main.includes("sidecarRpc('health'"),"sidecar stdio RPC missing");
assert.ok(main.includes("args=['--stdio']"),"sidecar stdio launch missing");
assert.ok(main.includes("safeStorage"),"secure provider storage missing");
assert.ok(preload.includes("research:(q)=>ipcRenderer.invoke('atlas:research'"),"preload research bridge missing");
assert.ok(preload.includes("inspectUrl:(url)=>ipcRenderer.invoke('atlas:inspect'"),"preload inspection bridge missing");
assert.equal(sidecar.includes("FastAPI"),false,"sidecar must not embed FastAPI");
assert.equal(sidecar.includes("uvicorn"),false,"sidecar must not embed Uvicorn");
assert.ok(sidecar.includes("def stdio_main()"),"stdio RPC loop missing");
assert.ok(sidecar.includes("generativelanguage.googleapis.com"),"direct Gemini transport missing");
assert.ok(spec.includes('"fastapi"')&&spec.includes('"uvicorn"'),"PyInstaller web-server exclusions missing");
assert.ok(spec.includes("console=True"),"frozen engine needs stdio console handles");
assert.ok(installer.includes("langchain-google-genai"),"Gemini adapter dependency missing");
assert.ok(index.includes("mode:'desktop-ipc'"),"desktop research IPC path missing");
assert.ok(index.includes("atlasDesktop?.inspectUrl"),"desktop inspect IPC path missing");
console.log(JSON.stringify({ok:true,renderer:"electron-ipc",agent:"stdio-json-rpc",loopback:false,cloud:"Gemini"}));
