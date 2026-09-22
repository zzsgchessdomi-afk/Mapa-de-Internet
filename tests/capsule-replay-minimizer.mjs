import "../lib/capsule-core.js";
import assert from "node:assert/strict";

const C=globalThis.AtlanexCapsule;

const left=await C.createCapsule({
 createdAt:"2026-09-22T00:00:00.000Z",
 producer:{name:"Atlanex Test"},
 incident:{kind:"agent-run",title:"Replay baseline"},
 run:{id:"a",objective:"Research vendor",mode:"baseline",coverage:70},
 timeline:[
  {t:0,stage:"planner",label:"Plan"},
  {t:100,stage:"discovery",label:"Search"},
  {t:200,stage:"evidence",label:"Snapshot"}
 ],
 evidence:[{entity:"Vendor",criterion:"API",quote:"API available",sourceUrl:"https://example.com",sha256:"a".repeat(64),verification:"exact-source-snapshot"}]
});

const right=await C.createCapsule({
 createdAt:"2026-09-22T00:00:01.000Z",
 producer:{name:"Atlanex Test"},
 incident:{kind:"agent-run",title:"Replay changed"},
 run:{id:"b",objective:"Research vendor",mode:"retry",coverage:80},
 timeline:[
  {t:0,stage:"planner",label:"Plan"},
  {t:100,stage:"discovery",label:"Search"},
  {t:240,stage:"evidence",label:"Snapshot"},
  {t:350,stage:"verifier",label:"Mismatch detected",detail:"evidence hash changed"}
 ],
 evidence:[
  {entity:"Vendor",criterion:"API",quote:"API changed",sourceUrl:"https://example.com",sha256:"b".repeat(64),verification:"exact-source-snapshot"},
  {entity:"Vendor",criterion:"Price",quote:"$10/month",sourceUrl:"https://example.com/pricing",sha256:"c".repeat(64),verification:"exact-source-snapshot"}
 ]
});

const d=C.compareCapsulesAdvanced(left,right);
assert.equal(d.timeline.added.length,1);
assert.equal(d.timeline.newIncidentEvents.length,1);
assert.equal(d.evidence.changedDetails.length,1);
assert.equal(d.evidence.added.length,1);
assert.ok(d.totals.evidenceChanges>=2);

const window=C.incidentWindow(right,{contextBefore:1,contextAfter:0});
assert.equal(window.reason,"incident");
assert.equal(window.events.at(-1).label,"Mismatch detected");

const minimized=await C.minimizeCapsule(right,{contextBefore:1,contextAfter:0,maxEvidence:1});
const minCheck=await C.verifyCapsule(minimized);
assert.equal(minCheck.ok,true,minCheck.errors.join("; "));
assert.ok(minimized.timeline.length<right.timeline.length);
assert.ok(minimized.evidence.length<=1);
assert.equal(minimized.metadata.minimal,true);
assert.equal(minimized.artifacts.minimizedFrom.payloadSha256,right.integrity.payloadSha256);

const testcase=await C.createRegressionTestcase(right,{contextBefore:1,contextAfter:0,maxEvidence:1});
assert.equal(testcase.format,"aicapsule-testcase");
const pass=await C.runRegressionTestcase(testcase);
assert.equal(pass.ok,true,pass.errors.join("; "));

const broken=structuredClone(testcase);
broken.fixture.timeline=[];
const fail=await C.runRegressionTestcase(broken);
assert.equal(fail.ok,false);
assert.ok(fail.errors.some(x=>x.includes("integrity")||x.includes("missing required stage")));

console.log(JSON.stringify({
 ok:true,
 advancedDiff:true,
 newIncidentEvents:d.timeline.newIncidentEvents.length,
 minimizedEvents:minimized.timeline.length,
 minimizedEvidence:minimized.evidence.length,
 testcasePass:pass.ok,
 brokenRejected:!fail.ok
}));
