import "../lib/capsule-core.js";
import assert from "node:assert/strict";

const C=globalThis.AtlanexCapsule;
assert.ok(C,"AtlanexCapsule global must exist");

const capsule=await C.createCapsule({
  producer:{name:"Atlanex",version:"test"},
  project:{id:"p1",name:"Capsule Test"},
  incident:{kind:"agent-failure",title:"Tool returned inconsistent evidence"},
  run:{id:"r1",objective:"Verify an API",authorization:"Bearer top-secret-token"},
  timeline:[
    {t:0,stage:"planner",label:"start"},
    {t:250,stage:"evidence",label:"snapshot",detail:"https://example.com/?api_key=abc123"}
  ],
  evidence:[{
    entity:"Example",
    criterion:"API",
    quote:"API is available",
    sourceUrl:"https://example.com/",
    sha256:"a".repeat(64),
    verification:"exact-source-snapshot"
  }],
  artifacts:{request:{api_key:"super-secret"}},
  metadata:{github_token:"ghp_abcdefghijklmnopqrstuvwxyz123456"}
});

assert.equal(capsule.format,"aicapsule");
assert.equal(capsule.specVersion,"0.1.0");
assert.match(capsule.integrity.payloadSha256,/^[a-f0-9]{64}$/);
assert.ok(capsule.integrity.redactions>=3);
assert.equal(capsule.run.authorization,"[REDACTED]");
assert.equal(capsule.artifacts.request.api_key,"[REDACTED]");

const verified=await C.verifyCapsule(capsule);
assert.equal(verified.ok,true,verified.errors.join("; "));

const tampered=structuredClone(capsule);
tampered.run.objective="Tampered";
const bad=await C.verifyCapsule(tampered);
assert.equal(bad.ok,false);
assert.ok(bad.errors.includes("Capsule payload hash mismatch"));

const stableA=C.stableStringify({b:2,a:1,nested:{z:3,a:4}});
const stableB=C.stableStringify({nested:{a:4,z:3},a:1,b:2});
assert.equal(stableA,stableB);

const capsule2=await C.createCapsule({
  producer:{name:"Atlanex",version:"test"},
  project:{id:"p1",name:"Capsule Test"},
  incident:{kind:"agent-failure",title:"Tool returned inconsistent evidence"},
  run:{id:"r2",objective:"Verify an API again",mode:"compare"},
  timeline:[
    {t:0,stage:"planner",label:"start"},
    {t:200,stage:"evidence",label:"snapshot"},
    {t:400,stage:"analysis",label:"changed"}
  ],
  evidence:[{
    entity:"Example",
    criterion:"API",
    quote:"API changed",
    sourceUrl:"https://example.com/",
    sha256:"b".repeat(64),
    verification:"exact-source-snapshot"
  }]
});

const diff=C.compareCapsules(capsule,capsule2);
assert.equal(diff.samePayload,false);
assert.equal(diff.evidence.changed.length,1);
assert.equal(diff.timeline.delta,1);
assert.ok(diff.runChanges.some(x=>x.field==="objective"));

console.log(JSON.stringify({
  ok:true,
  sha256:capsule.integrity.payloadSha256,
  redactions:capsule.integrity.redactions,
  tamperDetected:!bad.ok,
  compareChanged:diff.evidence.changed.length
}));
