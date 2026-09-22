import "../lib/capsule-core.js";
import fs from "node:fs/promises";
import path from "node:path";

const C=globalThis.AtlanexCapsule;
const args=process.argv.slice(2);
const outIndex=args.indexOf("--out");
const outPath=outIndex>=0?args[outIndex+1]:null;

const metrics=[];
function record(id,ok,details={}){metrics.push({id,ok:!!ok,...details})}

const base=await C.createCapsule({
  createdAt:"2026-09-22T00:00:00.000Z",
  producer:{name:"Atlanex Benchmark",version:"1"},
  project:{id:"bench",name:"Public Benchmark"},
  incident:{kind:"research-run",title:"Baseline evidence run"},
  run:{id:"base",objective:"Verify vendor API and pricing",mode:"baseline",coverage:75},
  timeline:[
    {t:0,stage:"planner",label:"Plan"},
    {t:100,stage:"discovery",label:"Search"},
    {t:220,stage:"evidence",label:"Snapshot"}
  ],
  evidence:[
    {entity:"Vendor",criterion:"API",quote:"API available",sourceUrl:"https://example.com/api",sha256:"a".repeat(64),verification:"exact-source-snapshot"}
  ]
});

const changed=await C.createCapsule({
  createdAt:"2026-09-22T00:00:01.000Z",
  producer:{name:"Atlanex Benchmark",version:"1"},
  project:{id:"bench",name:"Public Benchmark"},
  incident:{kind:"research-run",title:"Changed evidence run"},
  run:{id:"changed",objective:"Verify vendor API and pricing",mode:"retry",coverage:82},
  timeline:[
    {t:0,stage:"planner",label:"Plan"},
    {t:100,stage:"discovery",label:"Search"},
    {t:250,stage:"evidence",label:"Snapshot"},
    {t:330,stage:"verifier",label:"Mismatch detected",detail:"pricing evidence hash changed"}
  ],
  evidence:[
    {entity:"Vendor",criterion:"API",quote:"API changed",sourceUrl:"https://example.com/api",sha256:"b".repeat(64),verification:"exact-source-snapshot"},
    {entity:"Vendor",criterion:"Price",quote:"$10/month",sourceUrl:"https://example.com/pricing",sha256:"c".repeat(64),verification:"exact-source-snapshot"}
  ]
});

// 1. Canonical integrity detects payload tampering.
const tampered=structuredClone(base);
tampered.run.objective="tampered";
const tamperCheck=await C.verifyCapsule(tampered);
record("integrity_tamper_detection",!tamperCheck.ok,{errors:tamperCheck.errors});

// 2. ES256 signature verifies and wrong key is rejected.
const key=await C.generateSigningKey();
const signed=await C.signCapsule(base,key.privateJwk);
const signatureOk=await C.verifySignature(signed,key.publicJwk);
const wrongKey=await C.generateSigningKey();
const signatureWrong=await C.verifySignature(signed,wrongKey.publicJwk);
record("signature_trusted_key_verification",signatureOk.ok,{keyId:signatureOk.keyId});
record("signature_wrong_key_rejection",!signatureWrong.ok,{errors:signatureWrong.errors});

// 3. Advanced replay diff detects the newly introduced incident and evidence changes.
const diff=C.compareCapsulesAdvanced(base,changed);
record("advanced_replay_incident_detection",diff.timeline.newIncidentEvents.length===1,{
  newIncidentEvents:diff.timeline.newIncidentEvents.length,
  timelineChanges:diff.totals.timelineChanges
});
record("evidence_change_detection",diff.evidence.changedDetails.length===1&&diff.evidence.added.length===1,{
  changed:diff.evidence.changedDetails.length,
  added:diff.evidence.added.length
});

// 4. Minimizer reduces replay size while preserving a valid Capsule.
const minimal=await C.minimizeCapsule(changed,{contextBefore:1,contextAfter:0,maxEvidence:1});
const minimalCheck=await C.verifyCapsule(minimal);
record("incident_minimizer",minimalCheck.ok&&minimal.timeline.length<changed.timeline.length&&minimal.evidence.length<=1,{
  originalEvents:changed.timeline.length,
  minimalEvents:minimal.timeline.length,
  originalEvidence:changed.evidence.length,
  minimalEvidence:minimal.evidence.length
});

// 5. Generated testcase passes; mutation is rejected.
const testcase=await C.createRegressionTestcase(changed,{contextBefore:1,contextAfter:0,maxEvidence:1});
const testcasePass=await C.runRegressionTestcase(testcase);
const broken=structuredClone(testcase);
broken.fixture.timeline=[];
const testcaseFail=await C.runRegressionTestcase(broken);
record("generated_testcase_passes",testcasePass.ok,{events:testcasePass.timelineEvents,evidence:testcasePass.evidenceCount});
record("testcase_mutation_rejection",!testcaseFail.ok,{errors:testcaseFail.errors});

const passed=metrics.filter(x=>x.ok).length;
const report={
  format:"atlanex-public-benchmark",
  version:"1.0.0",
  deterministic:true,
  networkRequired:false,
  modelRequired:false,
  metrics,
  totals:{passed,failed:metrics.length-passed,total:metrics.length}
};

console.log(JSON.stringify(report,null,2));
if(outPath)await fs.writeFile(path.resolve(outPath),JSON.stringify(report,null,2)+"\n","utf8");
if(report.totals.failed)process.exit(1);
