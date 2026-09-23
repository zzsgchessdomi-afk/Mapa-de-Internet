import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root=process.cwd();
const checks=[],fail=[];
const ok=(name,pass,detail="")=>{checks.push({name,pass,detail});if(!pass)fail.push({name,detail})};
const text=p=>fs.readFileSync(path.join(root,p),"utf8");
const exists=p=>fs.existsSync(path.join(root,p));

const pkg=JSON.parse(text("package.json"));
ok("version",pkg.version==="29.1.0",pkg.version);
for(const p of ["index.html","api/research.js","api/inspect.js","lib/scanner.js","desktop/main.js","desktop/preload.cjs","desktop/package.json","desktop/sidecar/server.py","desktop/sidecar/requirements.txt",".github/workflows/windows-build.yml",".github/workflows/release.yml"])ok("exists "+p,exists(p),p);
const html=text("index.html");
ok("IA Machine",html.includes("runIAMachine")&&html.includes("machineQualified"));
ok("proof snapshots",html.includes("contentHash")&&html.includes("exactQuoteInSnapshot"));
ok("visible fatal boot",html.includes('id="atlasFatal"')&&html.includes("unhandledrejection"));
const research=text("api/research.js");
const providers=[...research.matchAll(/\["([^"]+)",async/g)].map(m=>m[1]);
ok("11 provider integrations",new Set(providers).size>=11,String(new Set(providers).size));
const main=text("desktop/main.js");
ok("packaged acceptance",main.includes("--acceptance-test")&&main.includes("runAcceptance"));
ok("live research gate",main.includes("live research acceptance failed"));
ok("snapshot gate",main.includes("live source snapshot/hash acceptance failed"));
ok("monitor gate",main.includes("monitor persistence live check failed"));
ok("deep agent gate",main.includes("--self-test-deep")&&main.includes("gpt_researcher_deep"));
const server=text("desktop/sidecar/server.py");
ok("CrewAI runtime test",server.includes("CrewAI runtime")||server.includes("crewai_runtime"));
ok("GPT Researcher deep test",server.includes("gpt_researcher_deep")&&server.includes("conduct_research"));
const wf=text(".github/workflows/windows-build.yml");
ok("portable acceptance workflow",wf.includes("--acceptance-test")&&wf.includes("Internet-Atlas-Portable"));
ok("NSIS install acceptance",wf.includes("NSIS")&&wf.includes("Installed app acceptance"));
ok("deep agent CI",wf.includes("--self-test-deep"));
const rootAudit=JSON.parse(text("package.json")).scripts?.["audit:all"]||"";
ok("Capsule CI gate",wf.includes("npm run test:capsule")||(wf.includes("npm run audit:all")&&rootAudit.includes("npm run test:capsule")));
ok("Capsule benchmark CI gate",wf.includes("npm run benchmark:capsule")||(wf.includes("npm run audit:all")&&rootAudit.includes("npm run benchmark:capsule")));
const preload=text("desktop/preload.cjs");
for(const channel of ["atlas:version","atlas:pick-research-files","atlas:open-evidence","atlas:agent-health","atlas:agent-doctor","atlas:agent-smoke","atlas:agent-start","atlas:agent-run","atlas:agent-cancel","atlas:monitor-list","atlas:monitor-sync","atlas:monitor-run-now","atlas:monitor-config"]){
  ok("IPC "+channel,preload.includes(channel)&&main.includes(channel),channel);
}
const spec=text("desktop/sidecar/atlas_agent.spec");
ok("PyInstaller LiteLLM runtime",spec.includes('"litellm"')&&spec.includes('"gpt_researcher"'));
ok("PyInstaller heavy native pruning",["chromadb","lancedb","onnxruntime","unstructured"].every(x=>spec.includes(x)));

const result={ok:!fail.length,version:pkg.version,checks,failures:fail,sha256:crypto.createHash("sha256").update(html).digest("hex")};
console.log(JSON.stringify(result,null,2));
process.exit(fail.length?1:0);
