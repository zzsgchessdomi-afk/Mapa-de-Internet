(function(root){
  "use strict";

  const SECRET_KEY=/^(?:api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|token|secret|password|passwd|cookie|set-cookie|session|sessionid|private[-_]?key)$/i;
  const SECRET_PATTERNS=[
    [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,"Bearer [REDACTED]"],
    [/\bsk-[A-Za-z0-9_-]{12,}\b/g,"[REDACTED_OPENAI_KEY]"],
    [/\bAIza[0-9A-Za-z_-]{20,}\b/g,"[REDACTED_GOOGLE_KEY]"],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,"[REDACTED_GITHUB_TOKEN]"],
    [/([?&](?:api[_-]?key|access[_-]?token|token|secret)=)[^&#\s]+/gi,"$1[REDACTED]"]
  ];

  function normalize(value){
    if(value===undefined)return null;
    if(value===null||typeof value==="string"||typeof value==="boolean")return value;
    if(typeof value==="number")return Number.isFinite(value)?value:null;
    if(Array.isArray(value))return value.map(normalize);
    if(typeof value==="object"){
      const out={};
      for(const key of Object.keys(value).sort())out[key]=normalize(value[key]);
      return out;
    }
    return String(value);
  }

  function stableStringify(value){
    return JSON.stringify(normalize(value));
  }

  async function sha256Hex(value){
    const bytes=new TextEncoder().encode(typeof value==="string"?value:stableStringify(value));
    const digest=await root.crypto.subtle.digest("SHA-256",bytes);
    return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
  }

  function redactString(value,counter){
    let text=String(value);
    for(const [pattern,replacement] of SECRET_PATTERNS){
      text=text.replace(pattern,m=>{counter.count++;return typeof replacement==="function"?replacement(m):replacement});
    }
    return text;
  }

  function redactWalk(value,counter,path){
    if(Array.isArray(value))return value.map((x,i)=>redactWalk(x,counter,path.concat(String(i))));
    if(value&&typeof value==="object"){
      const out={};
      for(const [key,val] of Object.entries(value)){
        if(SECRET_KEY.test(key)){
          if(val!==null&&val!==undefined&&String(val)!=="")counter.count++;
          out[key]="[REDACTED]";
        }else out[key]=redactWalk(val,counter,path.concat(key));
      }
      return out;
    }
    if(typeof value==="string")return redactString(value,counter);
    return value;
  }

  function redactSecrets(value){
    const counter={count:0};
    const redacted=redactWalk(value,counter,[]);
    return {value:redacted,redactions:counter.count};
  }

  function validateEvidence(evidence){
    const errors=[];
    for(let i=0;i<(evidence||[]).length;i++){
      const item=evidence[i]||{};
      if(item.sha256&&!/^[a-f0-9]{64}$/i.test(String(item.sha256)))errors.push(`evidence[${i}].sha256 is not SHA-256`);
      if(item.quote&&typeof item.quote!=="string")errors.push(`evidence[${i}].quote must be a string`);
      if(item.sourceUrl&&typeof item.sourceUrl!=="string")errors.push(`evidence[${i}].sourceUrl must be a string`);
    }
    return errors;
  }

  async function createCapsule(input={}){
    const createdAt=input.createdAt||new Date().toISOString();
    const source={
      format:"aicapsule",
      specVersion:"0.1.0",
      createdAt,
      producer:input.producer||{name:"Atlanex"},
      project:input.project||null,
      incident:input.incident||{kind:"research-run",title:"Captured run"},
      run:input.run||null,
      timeline:Array.isArray(input.timeline)?input.timeline:[],
      evidence:Array.isArray(input.evidence)?input.evidence:[],
      artifacts:input.artifacts||{},
      metadata:input.metadata||{}
    };
    const {value:redacted,redactions}=redactSecrets(source);
    const payloadSha256=await sha256Hex(redacted);
    return {
      ...redacted,
      integrity:{
        algorithm:"SHA-256",
        canonicalization:"sorted-json-v1",
        payloadSha256,
        redactions
      }
    };
  }

  async function verifyCapsule(capsule){
    const errors=[];
    if(!capsule||typeof capsule!=="object")return {ok:false,errors:["Capsule must be an object"]};
    if(capsule.format!=="aicapsule")errors.push("Unsupported format");
    if(capsule.specVersion!=="0.1.0")errors.push("Unsupported specVersion");
    const expected=String(capsule.integrity?.payloadSha256||"").toLowerCase();
    if(!/^[a-f0-9]{64}$/.test(expected))errors.push("Missing or invalid integrity.payloadSha256");
    errors.push(...validateEvidence(capsule.evidence));
    const payload={...capsule};
    delete payload.integrity;
    const actual=await sha256Hex(payload);
    if(expected&&actual!==expected)errors.push("Capsule payload hash mismatch");
    return {
      ok:errors.length===0,
      errors,
      expectedSha256:expected||null,
      actualSha256:actual,
      evidenceCount:Array.isArray(capsule.evidence)?capsule.evidence.length:0,
      timelineEvents:Array.isArray(capsule.timeline)?capsule.timeline.length:0,
      redactions:Number(capsule.integrity?.redactions)||0
    };
  }


  function base64UrlEncode(bytes){
    let binary="";
    const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    for(let i=0;i<view.length;i+=0x8000)binary+=String.fromCharCode(...view.subarray(i,i+0x8000));
    return root.btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }

  function base64UrlDecode(text){
    let s=String(text||"").replace(/-/g,"+").replace(/_/g,"/");
    while(s.length%4)s+="=";
    const binary=root.atob(s),out=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
    return out;
  }

  function publicJwkFromPrivateJwk(jwk){
    if(!jwk||jwk.kty!=="EC"||jwk.crv!=="P-256"||!jwk.x||!jwk.y)throw new Error("Expected an EC P-256 JWK");
    return {kty:"EC",crv:"P-256",x:jwk.x,y:jwk.y,ext:true,key_ops:["verify"]};
  }

  function publicJwkMaterial(jwk){
    if(!jwk||jwk.kty!=="EC"||jwk.crv!=="P-256"||!jwk.x||!jwk.y)throw new Error("Expected an EC P-256 public JWK");
    return {crv:"P-256",kty:"EC",x:String(jwk.x),y:String(jwk.y)};
  }

  async function keyFingerprint(publicJwk){
    return "sha256:"+await sha256Hex(publicJwkMaterial(publicJwk));
  }

  async function generateSigningKey(){
    const pair=await root.crypto.subtle.generateKey(
      {name:"ECDSA",namedCurve:"P-256"},
      true,
      ["sign","verify"]
    );
    const [privateJwk,publicJwk]=await Promise.all([
      root.crypto.subtle.exportKey("jwk",pair.privateKey),
      root.crypto.subtle.exportKey("jwk",pair.publicKey)
    ]);
    return {privateJwk,publicJwk,keyId:await keyFingerprint(publicJwk)};
  }

  async function signCapsule(capsule,privateJwk,options={}){
    const check=await verifyCapsule(capsule);
    if(!check.ok)throw new Error("Cannot sign an invalid capsule: "+check.errors.join("; "));
    const publicJwk=options.publicJwk||publicJwkFromPrivateJwk(privateJwk);
    const fingerprint=await keyFingerprint(publicJwk);
    if(options.keyId&&options.keyId!==fingerprint)throw new Error("Provided keyId does not match signing key");
    const key=await root.crypto.subtle.importKey(
      "jwk",
      privateJwk,
      {name:"ECDSA",namedCurve:"P-256"},
      false,
      ["sign"]
    );
    const message=new TextEncoder().encode(check.expectedSha256);
    const signature=await root.crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,message);
    const out=JSON.parse(JSON.stringify(capsule));
    out.integrity={
      ...out.integrity,
      signature:{
        algorithm:"ES256",
        keyId:fingerprint,
        publicKey:publicJwkMaterial(publicJwk),
        value:base64UrlEncode(signature)
      }
    };
    return out;
  }

  async function verifySignature(capsule,trustedPublicJwk=null){
    const integrity=await verifyCapsule(capsule);
    const errors=[...integrity.errors];
    const sig=capsule?.integrity?.signature;
    if(!integrity.ok)return {ok:false,integrityOk:false,signatureValid:false,keyId:sig?.keyId||null,trustedKey:!!trustedPublicJwk,errors};
    if(!sig||sig.algorithm!=="ES256"||!sig.value){
      errors.push("Missing or unsupported capsule signature");
      return {ok:false,integrityOk:true,signatureValid:false,keyId:null,trustedKey:!!trustedPublicJwk,errors};
    }
    try{
      const publicJwk=trustedPublicJwk||sig.publicKey;
      const fingerprint=await keyFingerprint(publicJwk);
      if(sig.keyId&&sig.keyId!==fingerprint)errors.push("Signature keyId does not match public key fingerprint");
      const key=await root.crypto.subtle.importKey(
        "jwk",
        {...publicJwkMaterial(publicJwk),ext:true,key_ops:["verify"]},
        {name:"ECDSA",namedCurve:"P-256"},
        false,
        ["verify"]
      );
      const valid=await root.crypto.subtle.verify(
        {name:"ECDSA",hash:"SHA-256"},
        key,
        base64UrlDecode(sig.value),
        new TextEncoder().encode(integrity.expectedSha256)
      );
      if(!valid)errors.push("Capsule signature verification failed");
      return {
        ok:errors.length===0&&valid,
        integrityOk:true,
        signatureValid:valid,
        keyId:fingerprint,
        trustedKey:!!trustedPublicJwk,
        errors
      };
    }catch(e){
      errors.push("Signature verification error: "+String(e?.message||e));
      return {ok:false,integrityOk:true,signatureValid:false,keyId:sig?.keyId||null,trustedKey:!!trustedPublicJwk,errors};
    }
  }


  function eventKey(event){
    const e=event||{};
    return [String(e.stage||"").trim().toLowerCase(),String(e.label||"").trim().toLowerCase()].join("|");
  }

  function timelineProfile(capsule){
    const timeline=Array.isArray(capsule?.timeline)?capsule.timeline:[];
    const stages={};
    let durationMs=0;
    const incidentPattern=/(error|fail|failed|failure|conflict|mismatch|invalid|retry|timeout|missing|gap|changed|tamper|exception)/i;
    const incidentEvents=[];
    for(let i=0;i<timeline.length;i++){
      const e=timeline[i]||{},stage=String(e.stage||"unknown");
      stages[stage]=(stages[stage]||0)+1;
      const t=Number(e.t)||0;if(t>durationMs)durationMs=t;
      if(incidentPattern.test([e.stage,e.label,e.detail].filter(Boolean).join(" ")))incidentEvents.push({...e,index:i});
    }
    return {events:timeline.length,durationMs,stages,incidentEvents};
  }

  function multisetDelta(left,right,keyFn){
    const l=new Map(),r=new Map();
    for(const item of left||[]){const k=keyFn(item);const a=l.get(k)||[];a.push(item);l.set(k,a)}
    for(const item of right||[]){const k=keyFn(item);const a=r.get(k)||[];a.push(item);r.set(k,a)}
    const added=[],removed=[],unchanged=[];
    for(const [key,items] of r){
      const before=l.get(key)||[],same=Math.min(before.length,items.length);
      unchanged.push(...items.slice(0,same));
      added.push(...items.slice(same));
    }
    for(const [key,items] of l){
      const after=r.get(key)||[],same=Math.min(after.length,items.length);
      removed.push(...items.slice(same));
    }
    return {added,removed,unchanged};
  }

  function compareCapsulesAdvanced(left,right){
    const base=compareCapsules(left,right);
    const lp=timelineProfile(left),rp=timelineProfile(right);
    const timelineDelta=multisetDelta(left?.timeline||[],right?.timeline||[],eventKey);
    const stageNames=[...new Set([...Object.keys(lp.stages),...Object.keys(rp.stages)])].sort();
    const stageDelta=stageNames.map(stage=>({
      stage,
      before:lp.stages[stage]||0,
      after:rp.stages[stage]||0,
      delta:(rp.stages[stage]||0)-(lp.stages[stage]||0)
    })).filter(x=>x.delta!==0);
    const changedEvidence=(base.evidence.changed||[]).map(x=>({
      key:x.key,
      beforeHash:x.before?.sha256||null,
      afterHash:x.after?.sha256||null,
      sourceUrl:x.after?.sourceUrl||x.before?.sourceUrl||null,
      entity:x.after?.entity||x.before?.entity||null,
      criterion:x.after?.criterion||x.before?.criterion||null
    }));
    return {
      ...base,
      timeline:{
        ...base.timeline,
        durationBeforeMs:lp.durationMs,
        durationAfterMs:rp.durationMs,
        durationDeltaMs:rp.durationMs-lp.durationMs,
        added:timelineDelta.added,
        removed:timelineDelta.removed,
        stageDelta,
        newIncidentEvents:rp.incidentEvents.filter(e=>!lp.incidentEvents.some(a=>eventKey(a)===eventKey(e)))
      },
      evidence:{
        ...base.evidence,
        changedDetails:changedEvidence
      },
      totals:{
        evidenceChanges:(base.evidence.added?.length||0)+(base.evidence.removed?.length||0)+(base.evidence.changed?.length||0),
        timelineChanges:timelineDelta.added.length+timelineDelta.removed.length,
        runChanges:base.runChanges.length
      }
    };
  }

  function incidentWindow(capsule,options={}){
    const timeline=Array.isArray(capsule?.timeline)?capsule.timeline:[];
    if(!timeline.length)return {start:0,end:-1,focusIndex:-1,events:[],reason:"empty"};
    const before=Math.max(0,Number(options.contextBefore??2));
    const after=Math.max(0,Number(options.contextAfter??2));
    const profile=timelineProfile(capsule);
    let focusIndex=Number.isInteger(options.focusIndex)?options.focusIndex:-1;
    if(focusIndex<0||focusIndex>=timeline.length){
      focusIndex=profile.incidentEvents.length?profile.incidentEvents[0].index:timeline.length-1;
    }
    const start=Math.max(0,focusIndex-before),end=Math.min(timeline.length-1,focusIndex+after);
    return {
      start,end,focusIndex,
      events:timeline.slice(start,end+1),
      reason:profile.incidentEvents.some(x=>x.index===focusIndex)?"incident":"tail"
    };
  }

  function evidenceForWindow(capsule,window,maxEvidence=6){
    const evidence=Array.isArray(capsule?.evidence)?capsule.evidence:[];
    if(!evidence.length)return [];
    const text=(window?.events||[]).map(e=>[e.stage,e.label,e.detail].filter(Boolean).join(" ")).join(" ").toLowerCase();
    const tokens=[...new Set(text.split(/[^a-z0-9_.:/-]+/i).filter(x=>x.length>=5))].slice(0,40);
    const scored=evidence.map((e,index)=>{
      const hay=[e.entity,e.criterion,e.quote,e.sourceUrl,e.sha256].filter(Boolean).join(" ").toLowerCase();
      let score=e.verification&&e.verification!=="exact-source-snapshot"?2:0;
      for(const token of tokens)if(hay.includes(token))score++;
      return {e,index,score};
    }).sort((a,b)=>b.score-a.score||a.index-b.index);
    const matched=scored.filter(x=>x.score>0).slice(0,maxEvidence).map(x=>x.e);
    return matched.length?matched:scored.slice(0,maxEvidence).map(x=>x.e);
  }

  async function minimizeCapsule(capsule,options={}){
    const check=await verifyCapsule(capsule);
    if(!check.ok)throw new Error("Cannot minimize an invalid capsule: "+check.errors.join("; "));
    const window=incidentWindow(capsule,options);
    const evidence=evidenceForWindow(capsule,window,Math.max(1,Number(options.maxEvidence||6)));
    return await createCapsule({
      createdAt:new Date().toISOString(),
      producer:{name:"Atlanex Minimizer",version:"0.1"},
      project:capsule.project||null,
      incident:{
        ...(capsule.incident||{kind:"research-run",title:"Minimized incident"}),
        title:String(capsule.incident?.title||capsule.run?.objective||"Minimized incident")+" · minimal reproduction"
      },
      run:capsule.run?{
        id:capsule.run.id||null,
        objective:capsule.run.objective||null,
        mode:capsule.run.mode||null,
        depth:capsule.run.depth||null,
        coverage:capsule.run.coverage??null
      }:null,
      timeline:window.events,
      evidence,
      artifacts:{
        minimizedFrom:{
          payloadSha256:capsule.integrity?.payloadSha256||null,
          timelineEvents:(capsule.timeline||[]).length,
          evidenceCount:(capsule.evidence||[]).length,
          window:{start:window.start,end:window.end,focusIndex:window.focusIndex,reason:window.reason}
        }
      },
      metadata:{
        minimal:true,
        sourceSpecVersion:capsule.specVersion||null,
        sourceProducer:capsule.producer||null
      }
    });
  }

  async function createRegressionTestcase(capsule,options={}){
    const fixture=options.keepFull===true?capsule:await minimizeCapsule(capsule,options);
    const check=await verifyCapsule(fixture);
    if(!check.ok)throw new Error("Cannot create testcase from invalid fixture");
    const stages=[...new Set((fixture.timeline||[]).map(e=>String(e.stage||"unknown")))];
    const hashes=(fixture.evidence||[]).map(e=>e.sha256).filter(Boolean);
    return {
      format:"aicapsule-testcase",
      specVersion:"0.1.0",
      createdAt:new Date().toISOString(),
      sourcePayloadSha256:capsule.integrity?.payloadSha256||null,
      fixture,
      assertions:{
        integrity:true,
        requireSignature:!!options.requireSignature,
        minEvidence:Number(options.minEvidence??0),
        requiredStages:stages,
        evidenceHashes:hashes
      }
    };
  }

  async function runRegressionTestcase(testcase){
    const errors=[];
    if(!testcase||testcase.format!=="aicapsule-testcase")return {ok:false,errors:["Unsupported testcase format"]};
    const fixture=testcase.fixture;
    const check=await verifyCapsule(fixture);
    if(!check.ok)errors.push(...check.errors.map(x=>"integrity: "+x));
    const assertions=testcase.assertions||{};
    if(assertions.requireSignature){
      const sig=await verifySignature(fixture);
      if(!sig.ok)errors.push(...sig.errors.map(x=>"signature: "+x));
    }
    const evidence=fixture?.evidence||[];
    if(evidence.length<Number(assertions.minEvidence||0))errors.push("evidence count below minimum");
    const stages=new Set((fixture?.timeline||[]).map(e=>String(e.stage||"unknown")));
    for(const stage of assertions.requiredStages||[])if(!stages.has(stage))errors.push("missing required stage: "+stage);
    const hashes=new Set(evidence.map(e=>e.sha256).filter(Boolean));
    for(const hash of assertions.evidenceHashes||[])if(!hashes.has(hash))errors.push("missing evidence hash: "+hash);
    return {
      ok:errors.length===0,
      errors,
      fixtureSha256:fixture?.integrity?.payloadSha256||null,
      timelineEvents:(fixture?.timeline||[]).length,
      evidenceCount:evidence.length
    };
  }

  function summary(capsule){
    return {
      format:capsule?.format||null,
      specVersion:capsule?.specVersion||null,
      createdAt:capsule?.createdAt||null,
      producer:capsule?.producer?.name||null,
      project:capsule?.project?.name||null,
      objective:capsule?.run?.objective||capsule?.incident?.title||null,
      evidenceCount:Array.isArray(capsule?.evidence)?capsule.evidence.length:0,
      timelineEvents:Array.isArray(capsule?.timeline)?capsule.timeline.length:0,
      sha256:capsule?.integrity?.payloadSha256||null,
      signed:!!capsule?.integrity?.signature,
      keyId:capsule?.integrity?.signature?.keyId||null
    };
  }


  function compareCapsules(left,right){
    const evidenceKey=e=>[e?.entity||"",e?.criterion||"",e?.sourceUrl||""].join("|");
    const lMap=new Map((left?.evidence||[]).map(e=>[evidenceKey(e),e]));
    const rMap=new Map((right?.evidence||[]).map(e=>[evidenceKey(e),e]));
    const added=[],removed=[],changed=[],unchanged=[];
    for(const [key,item] of rMap){
      if(!lMap.has(key)){added.push(item);continue}
      const before=lMap.get(key);
      if(stableStringify(before)===stableStringify(item))unchanged.push(item);
      else changed.push({key,before,after:item});
    }
    for(const [key,item] of lMap)if(!rMap.has(key))removed.push(item);
    const fields=["objective","mode","depth","coverage"];
    const runChanges=[];
    for(const field of fields){
      const before=left?.run?.[field]??null,after=right?.run?.[field]??null;
      if(stableStringify(before)!==stableStringify(after))runChanges.push({field,before,after});
    }
    return {
      samePayload:String(left?.integrity?.payloadSha256||"")===String(right?.integrity?.payloadSha256||""),
      leftSha256:left?.integrity?.payloadSha256||null,
      rightSha256:right?.integrity?.payloadSha256||null,
      timeline:{left:(left?.timeline||[]).length,right:(right?.timeline||[]).length,delta:(right?.timeline||[]).length-(left?.timeline||[]).length},
      evidence:{added,removed,changed,unchanged},
      runChanges
    };
  }

  root.AtlanexCapsule=Object.freeze({
    stableStringify,
    sha256Hex,
    redactSecrets,
    createCapsule,
    verifyCapsule,
    summary,
    compareCapsules,
    generateSigningKey,
    keyFingerprint,
    signCapsule,
    verifySignature,
    publicJwkFromPrivateJwk,
    timelineProfile,
    compareCapsulesAdvanced,
    incidentWindow,
    minimizeCapsule,
    createRegressionTestcase,
    runRegressionTestcase
  });
})(globalThis);
