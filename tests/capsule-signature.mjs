import "../lib/capsule-core.js";
import assert from "node:assert/strict";

const C=globalThis.AtlanexCapsule;
const capsule=await C.createCapsule({
  createdAt:"2026-09-22T00:00:00.000Z",
  producer:{name:"Atlanex",version:"signature-test"},
  project:{id:"sig",name:"Signature Test"},
  incident:{kind:"research-run",title:"Signed evidence"},
  run:{id:"r1",objective:"Prove capsule signing"},
  timeline:[{t:0,stage:"capture",label:"start"}],
  evidence:[{
    entity:"Atlanex",
    criterion:"signature",
    quote:"signed",
    sourceUrl:"https://example.com/",
    sha256:"c".repeat(64),
    verification:"exact-source-snapshot"
  }]
});

const key=await C.generateSigningKey();
assert.match(key.keyId,/^sha256:[a-f0-9]{64}$/);

const signed=await C.signCapsule(capsule,key.privateJwk);
assert.equal(signed.integrity.payloadSha256,capsule.integrity.payloadSha256);
assert.equal(signed.integrity.signature.algorithm,"ES256");
assert.equal(signed.integrity.signature.keyId,key.keyId);

const embedded=await C.verifySignature(signed);
assert.equal(embedded.ok,true,embedded.errors.join("; "));
assert.equal(embedded.signatureValid,true);

const trusted=await C.verifySignature(signed,key.publicJwk);
assert.equal(trusted.ok,true,trusted.errors.join("; "));
assert.equal(trusted.trustedKey,true);

const other=await C.generateSigningKey();
const wrong=await C.verifySignature(signed,other.publicJwk);
assert.equal(wrong.ok,false);
assert.ok(wrong.errors.some(x=>x.includes("keyId")||x.includes("verification failed")));

const tampered=structuredClone(signed);
tampered.run.objective="tampered";
const tamperCheck=await C.verifySignature(tampered,key.publicJwk);
assert.equal(tamperCheck.ok,false);
assert.equal(tamperCheck.integrityOk,false);

const badSignature=structuredClone(signed);
const raw=badSignature.integrity.signature.value;
badSignature.integrity.signature.value=(raw[0]==="A"?"B":"A")+raw.slice(1);
const badSigCheck=await C.verifySignature(badSignature,key.publicJwk);
assert.equal(badSigCheck.ok,false);
assert.equal(badSigCheck.integrityOk,true);
assert.equal(badSigCheck.signatureValid,false);

console.log(JSON.stringify({
  ok:true,
  algorithm:signed.integrity.signature.algorithm,
  keyId:key.keyId,
  trustedVerification:trusted.ok,
  wrongKeyRejected:!wrong.ok,
  tamperRejected:!tamperCheck.ok,
  badSignatureRejected:!badSigCheck.ok
}));
