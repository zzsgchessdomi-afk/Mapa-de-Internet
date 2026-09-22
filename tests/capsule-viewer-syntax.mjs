import fs from "node:fs/promises";
import assert from "node:assert/strict";

const html=await fs.readFile(new URL("../tools/capsule-viewer.html",import.meta.url),"utf8");
assert.ok(html.includes("../lib/capsule-core.js"));
assert.ok(html.includes("compareCapsulesAdvanced"));
assert.ok(html.includes("minimizeCapsule"));
assert.ok(html.includes("createRegressionTestcase"));
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/\bsrc\s*=/.test(m[1]||"")).map(m=>m[2]||"");
assert.ok(scripts.length>0);
for(let i=0;i<scripts.length;i++)new Function(scripts[i]);
console.log(JSON.stringify({ok:true,viewerSyntax:true,inlineScripts:scripts.length}));
