import "../lib/capsule-core.js";
import fs from "node:fs/promises";

const C=globalThis.AtlanexCapsule;
const capsule=await C.createCapsule({
  createdAt:"2026-09-22T00:00:00.000Z",
  producer:{name:"Atlanex CI"},
  incident:{kind:"ci",title:"GitHub Action signed fixture"},
  run:{id:"ci-run",objective:"Verify reusable GitHub Action"},
  timeline:[{t:0,stage:"ci",label:"fixture"}],
  evidence:[]
});
const key=await C.generateSigningKey();
const signed=await C.signCapsule(capsule,key.privateJwk);
await fs.writeFile("tests/.tmp-signed.aicapsule",JSON.stringify(signed,null,2)+"\n","utf8");
await fs.writeFile("tests/.tmp-public.jwk.json",JSON.stringify(key.publicJwk,null,2)+"\n","utf8");
console.log(JSON.stringify({ok:true,keyId:key.keyId}));
