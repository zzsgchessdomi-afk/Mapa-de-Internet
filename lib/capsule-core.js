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
      sha256:capsule?.integrity?.payloadSha256||null
    };
  }

  root.AtlanexCapsule=Object.freeze({
    stableStringify,
    sha256Hex,
    redactSecrets,
    createCapsule,
    verifyCapsule,
    summary
  });
})(globalThis);
