import "../lib/capsule-core.js";
import fs from "node:fs/promises";
import path from "node:path";

const C=globalThis.AtlanexCapsule;
const args=process.argv.slice(2);
const command=args[0];

function usage(){
  console.error([
    "Atlanex AI Capsule CLI",
    "  verify <file.aicapsule>",
    "  summary <file.aicapsule>",
    "  compare <left.aicapsule> <right.aicapsule>",
    "  compare-advanced <left.aicapsule> <right.aicapsule>",
    "  minimize <file.aicapsule> [output.aicapsule]",
    "  testcase <file.aicapsule> [output.json]",
    "  run-testcase <testcase.json>",
    "  keygen <output-prefix>",
    "  sign <file.aicapsule> <private.jwk.json> [output.aicapsule]",
    "  verify-signature <file.aicapsule> [trusted-public.jwk.json]"
  ].join("\n"));
}

async function readJson(file,label="JSON file"){
  try{return JSON.parse(await fs.readFile(path.resolve(file),"utf8"))}
  catch(e){throw new Error(`Unable to read ${label}: ${e.message}`)}
}

async function readCapsule(file){
  return await readJson(file,"capsule");
}

if(!command){
  usage();
  process.exit(2);
}

try{
  if(command==="keygen"){
    const prefix=args[1];
    if(!prefix){usage();process.exit(2)}
    const key=await C.generateSigningKey();
    const base=path.resolve(prefix);
    const privatePath=base+".private.jwk.json";
    const publicPath=base+".public.jwk.json";
    await fs.writeFile(privatePath,JSON.stringify(key.privateJwk,null,2)+"\n",{encoding:"utf8",mode:0o600});
    await fs.writeFile(publicPath,JSON.stringify(key.publicJwk,null,2)+"\n","utf8");
    console.log(JSON.stringify({ok:true,keyId:key.keyId,privateKey:privatePath,publicKey:publicPath},null,2));
    process.exit(0);
  }

  if(command==="verify"){
    if(!args[1]){usage();process.exit(2)}
    const capsule=await readCapsule(args[1]);
    const result=await C.verifyCapsule(capsule);
    console.log(JSON.stringify(result,null,2));
    process.exit(result.ok?0:1);
  }

  if(command==="summary"){
    if(!args[1]){usage();process.exit(2)}
    const capsule=await readCapsule(args[1]);
    console.log(JSON.stringify(C.summary(capsule),null,2));
    process.exit(0);
  }

  if(command==="compare"){
    if(!args[1]||!args[2]){usage();process.exit(2)}
    const [left,right]=await Promise.all([readCapsule(args[1]),readCapsule(args[2])]);
    const [leftCheck,rightCheck]=await Promise.all([C.verifyCapsule(left),C.verifyCapsule(right)]);
    if(!leftCheck.ok||!rightCheck.ok){
      console.error(JSON.stringify({left:leftCheck,right:rightCheck},null,2));
      process.exit(1);
    }
    console.log(JSON.stringify(C.compareCapsules(left,right),null,2));
    process.exit(0);
  }

  if(command==="compare-advanced"){
    if(!args[1]||!args[2]){usage();process.exit(2)}
    const [left,right]=await Promise.all([readCapsule(args[1]),readCapsule(args[2])]);
    const [leftCheck,rightCheck]=await Promise.all([C.verifyCapsule(left),C.verifyCapsule(right)]);
    if(!leftCheck.ok||!rightCheck.ok){
      console.error(JSON.stringify({left:leftCheck,right:rightCheck},null,2));
      process.exit(1);
    }
    console.log(JSON.stringify(C.compareCapsulesAdvanced(left,right),null,2));
    process.exit(0);
  }

  if(command==="minimize"){
    const capsulePath=args[1],outputPath=args[2];
    if(!capsulePath){usage();process.exit(2)}
    const capsule=await readCapsule(capsulePath);
    const minimized=await C.minimizeCapsule(capsule);
    const out=path.resolve(outputPath||capsulePath.replace(/\.aicapsule$/i,"")+".minimal.aicapsule");
    await fs.writeFile(out,JSON.stringify(minimized,null,2)+"\n","utf8");
    console.log(JSON.stringify({ok:true,output:out,sha256:minimized.integrity.payloadSha256,timelineEvents:minimized.timeline.length,evidenceCount:minimized.evidence.length},null,2));
    process.exit(0);
  }

  if(command==="testcase"){
    const capsulePath=args[1],outputPath=args[2];
    if(!capsulePath){usage();process.exit(2)}
    const capsule=await readCapsule(capsulePath);
    const testcase=await C.createRegressionTestcase(capsule);
    const out=path.resolve(outputPath||capsulePath.replace(/\.aicapsule$/i,"")+".testcase.json");
    await fs.writeFile(out,JSON.stringify(testcase,null,2)+"\n","utf8");
    console.log(JSON.stringify({ok:true,output:out,fixtureSha256:testcase.fixture.integrity.payloadSha256},null,2));
    process.exit(0);
  }

  if(command==="run-testcase"){
    if(!args[1]){usage();process.exit(2)}
    const testcase=await readJson(args[1],"testcase");
    const result=await C.runRegressionTestcase(testcase);
    console.log(JSON.stringify(result,null,2));
    process.exit(result.ok?0:1);
  }

  if(command==="sign"){
    const capsulePath=args[1],privateKeyPath=args[2],outputPath=args[3];
    if(!capsulePath||!privateKeyPath){usage();process.exit(2)}
    const [capsule,privateJwk]=await Promise.all([
      readCapsule(capsulePath),
      readJson(privateKeyPath,"private JWK")
    ]);
    const signed=await C.signCapsule(capsule,privateJwk);
    const out=path.resolve(outputPath||capsulePath.replace(/\.aicapsule$/i,"")+".signed.aicapsule");
    await fs.writeFile(out,JSON.stringify(signed,null,2)+"\n","utf8");
    const check=await C.verifySignature(signed);
    console.log(JSON.stringify({ok:check.ok,output:out,keyId:check.keyId,sha256:signed.integrity.payloadSha256},null,2));
    process.exit(check.ok?0:1);
  }

  if(command==="verify-signature"){
    const capsulePath=args[1],trustedKeyPath=args[2];
    if(!capsulePath){usage();process.exit(2)}
    const capsule=await readCapsule(capsulePath);
    const trusted=trustedKeyPath?await readJson(trustedKeyPath,"trusted public JWK"):null;
    const result=await C.verifySignature(capsule,trusted);
    console.log(JSON.stringify(result,null,2));
    process.exit(result.ok?0:1);
  }

  usage();
  process.exit(2);
}catch(e){
  console.error(JSON.stringify({ok:false,error:String(e?.message||e)},null,2));
  process.exit(1);
}
