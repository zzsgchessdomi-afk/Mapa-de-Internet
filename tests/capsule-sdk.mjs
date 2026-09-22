import * as SDK from "../sdk/javascript/index.mjs";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

const schema=JSON.parse(await fs.readFile(new URL("../schemas/aicapsule-0.1.schema.json",import.meta.url),"utf8"));
assert.equal(schema.$schema,"https://json-schema.org/draft/2020-12/schema");
assert.equal(schema.properties.format.const,"aicapsule");
assert.ok(schema.required.includes("integrity"));

const capsule=await SDK.createCapsule({
  createdAt:"2026-09-22T00:00:00.000Z",
  producer:{name:"SDK Test"},
  incident:{kind:"sdk",title:"Import test"},
  timeline:[],
  evidence:[]
});
const check=await SDK.verifyCapsule(capsule);
assert.equal(check.ok,true,check.errors.join("; "));
assert.equal(SDK.summary(capsule).producer,"SDK Test");
assert.equal(typeof SDK.generateSigningKey,"function");

console.log(JSON.stringify({ok:true,sdkImport:true,schemaParsed:true}));
