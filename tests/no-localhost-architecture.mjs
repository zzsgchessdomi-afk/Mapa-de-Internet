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

const combined=[main,preload,sidecar].join("\n");
for(const forbidden of ["127.0.0.1","localhost"]){
  assert.equal(combined.includes(forbidden),false,`forbidden loopback transport marker remains: ${forbidden}`);
}

assert.equal(/from ['"]node:http['"]/.test(main),false,"desktop host must not import node:http");
assert.equal(/from ['"]node:net['"]/.test(main),false,"desktop host must not import node:net");
assert.equal(main.includes("loadFile(path.join(appDir,'index.html'))"),true,"renderer must load from local file");
assert.equal(main.includes("atlas:research"),true,"research IPC missing");
assert.equal(main.includes("atlas:inspect"),true,"inspect IPC missing");
assert.equal(main.includes("safeStorage"),true,"encrypted Gemini storage missing");
assert.equal(main.includes("sidecarRpc('health'"),true,"sidecar RPC missing");
assert.equal(main.includes("args=['--stdio']"),true,"packaged sidecar must launch with stdio");

assert.equal(preload.includes("research:(q)=>ipcRenderer.invoke('atlas:research'"),true,"preload research bridge missing");
assert.equal(preload.includes("inspectUrl:(url)=>ipcRenderer.invoke('atlas:inspect'"),true,"preload inspect bridge missing");
assert.equal(preload.includes("configureGemini"),true,"preload Gemini config bridge missing");
assert.equal(preload.includes("onLLMRequest"),false,"legacy renderer LLM bridge remains");

assert.equal(sidecar.includes("uvicorn"),false,"sidecar must not run uvicorn");
assert.equal(sidecar.includes("FastAPI"),false,"sidecar must not run FastAPI");
assert.equal(sidecar.includes("def stdio_main()"),true,"stdio RPC loop missing");
assert.equal(sidecar.includes('transport":"stdio"'),true,"stdio transport health marker missing");
assert.equal(sidecar.includes("generativelanguage.googleapis.com"),true,"direct Gemini transport missing");
assert.equal(sidecar.includes("google_genai:"),true,"GPT Researcher Gemini adapter missing");

assert.equal(spec.includes('"fastapi"'),true,"PyInstaller must explicitly exclude FastAPI");
assert.equal(spec.includes('"uvicorn"'),true,"PyInstaller must explicitly exclude Uvicorn");
assert.equal(spec.includes("console=True"),true,"Windows engine needs stdio console handles");
assert.equal(installer.includes("langchain-google-genai"),true,"Gemini adapter dependency missing");

assert.equal(index.includes("mode:'desktop-ipc'"),true,"renderer does not use desktop IPC for research");
assert.equal(index.includes("atlasDesktop?.inspectUrl"),true,"renderer does not use desktop IPC for inspection");
assert.equal(index.includes('id="agentGeminiKey"'),true,"Gemini config UI missing");
assert.equal(index.includes("clave cifrada en Windows"),true,"secure-storage UX missing");
assert.equal(index.includes("atlasDesktop?.onLLMRequest"),false,"legacy renderer LLM bridge remains in UI");

console.log(JSON.stringify({
  ok:true,
  rendererTransport:"electron-ipc",
  sidecarTransport:"stdio-json-rpc",
  loopback:false,
  provider:"gemini-cloud",
  secureKeyStorage:true
}));
