import dns from "node:dns/promises";
import net from "node:net";
import { createHash } from "node:crypto";

const MAX_BYTES = 1_500_000;
const MAX_PDF_BYTES = 15_000_000;
const MAX_LINKS = 220;
export const ATLAS_UA = "Mozilla/5.0 (compatible; InternetAtlas/1.0; research client)";

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return true;
  return p[0]===10 || p[0]===127 || p[0]===0 || (p[0]===169&&p[1]===254) ||
    (p[0]===172&&p[1]>=16&&p[1]<=31) || (p[0]===192&&p[1]===168) ||
    (p[0]===100&&p[1]>=64&&p[1]<=127) || p[0]>=224;
}
function isPrivateIPv6(ip) {
  const s=ip.toLowerCase();
  return s==="::1" || s==="::" || s.startsWith("fc") || s.startsWith("fd") ||
    s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb");
}
export async function validateTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("URL inválida"); }
  if (!["http:","https:"].includes(u.protocol)) throw new Error("Protocolo no permitido");
  const h=u.hostname.toLowerCase();
  if (h==="localhost" || h.endsWith(".local") || h.endsWith(".internal")) throw new Error("Host privado");
  if (net.isIP(h)) {
    if ((net.isIP(h)===4&&isPrivateIPv4(h)) || (net.isIP(h)===6&&isPrivateIPv6(h))) throw new Error("IP privada");
  } else {
    const ips=await dns.lookup(h,{all:true,verbatim:true});
    if (!ips.length) throw new Error("Dominio sin DNS");
    for (const x of ips) {
      if ((x.family===4&&isPrivateIPv4(x.address)) || (x.family===6&&isPrivateIPv6(x.address))) {
        throw new Error("Destino privado");
      }
    }
  }
  return u;
}
function patternToRegex(pattern) {
  let end=false;
  if (pattern.endsWith("$")) { end=true; pattern=pattern.slice(0,-1); }
  const escaped=pattern.replace(/[.+?^${}()|[\]\\]/g,"\\$&").replace(/\*/g,".*");
  try { return new RegExp("^"+escaped+(end?"$":"")); } catch { return null; }
}
function parseRobots(text, agent="InternetAtlasX") {
  const groups=[];let agents=[],rules=[];
  const flush=()=>{if(agents.length)groups.push({agents:[...agents],rules:[...rules]});agents=[];rules=[]};
  for(const raw of text.split(/\r?\n/)){
    const line=raw.replace(/#.*$/,"").trim();if(!line)continue;
    const i=line.indexOf(":");if(i<0)continue;
    const key=line.slice(0,i).trim().toLowerCase(),value=line.slice(i+1).trim();
    if(key==="user-agent"){if(rules.length)flush();agents.push(value.toLowerCase())}
    else if((key==="allow"||key==="disallow")&&agents.length&&value!=="")rules.push({type:key,path:value});
  }
  flush();
  const a=agent.toLowerCase();
  let matches=groups.filter(g=>g.agents.some(x=>x==="*"||a.includes(x)));
  if(!matches.length)return [];
  const specific=Math.max(...matches.flatMap(g=>g.agents.map(x=>x==="*"?0:x.length)));
  matches=matches.filter(g=>g.agents.some(x=>(x==="*"?0:x.length)===specific));
  return matches.flatMap(g=>g.rules);
}
function robotsAllows(path,rules){
  let best=null;
  for(const r of rules){
    const rx=patternToRegex(r.path);if(!rx||!rx.test(path))continue;
    const score=r.path.replace(/\*/g,"").length;
    if(!best||score>best.score||(score===best.score&&r.type==="allow"))best={score,type:r.type};
  }
  return !best||best.type==="allow";
}
async function checkRobots(target){
  let current=await validateTarget(new URL("/robots.txt",target).href);
  for(let i=0;i<4;i++){
    const r=await fetch(current,{redirect:"manual",headers:{"User-Agent":ATLAS_UA,"Accept":"text/plain,*/*;q=0.2"}});
    if([301,302,303,307,308].includes(r.status)){
      const loc=r.headers.get("location");if(!loc)break;
      current=await validateTarget(new URL(loc,current).href);continue;
    }
    if(r.status===404||r.status===410)return {allowed:true,reason:"robots-missing"};
    if(r.status===401||r.status===403)return {allowed:false,reason:"robots-denied"};
    if(r.status>=500||r.status===429)return {allowed:false,reason:"robots-unavailable"};
    if(!r.ok)return {allowed:true,reason:"robots-other"};
    const text=(await r.text()).slice(0,512000);
    return {allowed:robotsAllows(target.pathname+(target.search||""),parseRobots(text,ATLAS_UA)),reason:"robots-rules"};
  }
  return {allowed:false,reason:"robots-redirect"};
}
async function safeFetch(start){
  let current=await validateTarget(start);
  for(let i=0;i<5;i++){
    const r=await fetch(current,{redirect:"manual",headers:{"User-Agent":ATLAS_UA,"Accept":"text/html,application/xhtml+xml;q=0.9,*/*;q=0.4"}});
    if([301,302,303,307,308].includes(r.status)){
      const loc=r.headers.get("location");if(!loc)return {r,current};
      current=await validateTarget(new URL(loc,current).href);continue;
    }
    return {r,current};
  }
  throw new Error("Demasiadas redirecciones");
}
function decode(s=""){
  return s.replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'")
    .replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#x27;/gi,"'")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g," ").trim();
}
function stripTags(s=""){
  return decode(s.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," "));
}
function extractReadableText(html=""){
  let s=String(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<noscript[\s\S]*?<\/noscript>/gi," ");
  s=s.replace(/<\s*br\s*\/?\s*>/gi,"\n").replace(/<\/(p|div|section|article|main|header|footer|li|h[1-6]|tr|td|th|blockquote|pre)>/gi,"\n").replace(/<li\b[^>]*>/gi,"• ").replace(/<[^>]+>/g," ");
  s=s.replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&#x27;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
  return s.split(/\r?\n/).map(x=>x.replace(/[\t ]+/g," ").trim()).filter(Boolean).join("\n");
}
function getTitle(html){
  const m=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m?stripTags(m[1]).slice(0,180):"";
}
function getDescription(html){
  const patterns=[
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["'][^>]*>/i
  ];
  for(const p of patterns){const m=html.match(p);if(m)return decode(m[1]).slice(0,700)}
  return stripTags(html).slice(0,700);
}
function detectTech(html,headers,url){
  const t=[],low=html.toLowerCase(),server=(headers.get("server")||"").toLowerCase(),powered=(headers.get("x-powered-by")||"").toLowerCase();
  const add=x=>{if(x&&!t.includes(x))t.push(x)};
  if(/wp-content|wp-includes|wordpress/.test(low))add("WordPress");
  if(/__next_data__|\/_next\//.test(low))add("Next.js");
  if(/__nuxt__|\/_nuxt\//.test(low))add("Nuxt");
  if(/data-reactroot|react-dom|react\./.test(low))add("React");
  if(/vue(\.runtime|\.min)?\.js|data-v-/.test(low))add("Vue");
  if(/ng-version|angular/.test(low))add("Angular");
  if(/cdn\.shopify|shopify\.com|shopify-section/.test(low))add("Shopify");
  if(/wixstatic|wix\.com/.test(low))add("Wix");
  if(/squarespace/.test(low))add("Squarespace");
  if(/cloudflare/.test(server)||headers.get("cf-ray"))add("Cloudflare");
  if(/nginx/.test(server))add("nginx");
  if(/apache/.test(server))add("Apache");
  if(/vercel/.test(server)||headers.get("x-vercel-id"))add("Vercel");
  if(powered)add("Powered: "+powered.slice(0,40));
  if(headers.get("content-security-policy"))add("CSP");
  if(url.protocol==="https:")add("HTTPS");
  return t.slice(0,14);
}
function extractLinks(html,base){
  const origin=new URL(base),src=origin.hostname.replace(/^www\./,"").toLowerCase();
  const external=new Map(),internal=new Map();let total=0;
  const re=/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(html))&&total<3000){
    total++;let href=decode(m[2]).trim();if(!href||href.startsWith("#")||/^(mailto:|tel:|javascript:|data:)/i.test(href))continue;
    try{
      const u=new URL(href,origin);if(!["http:","https:"].includes(u.protocol))continue;u.hash="";
      const d=u.hostname.replace(/^www\./,"").toLowerCase(),label=stripTags(m[3]).slice(0,120)||u.pathname;
      if(d===src){
        const k=u.href.replace(/\/$/,"");
        if(!internal.has(k)&&internal.size<MAX_LINKS)internal.set(k,{url:u.href,title:label||u.pathname,domain:d});
      }else if(!external.has(d)&&external.size<MAX_LINKS){
        external.set(d,{url:u.protocol+"//"+u.hostname+"/",title:label||d,domain:d});
      }
    }catch{}
  }
  return {
    externalLinks:[...external.values()],
    internalLinks:[...internal.values()],
    externalCount:external.size,
    internalCount:internal.size,
    totalAnchors:total
  };
}
async function readBytesLimited(response,limit=MAX_PDF_BYTES){
  const reader=response.body?.getReader();
  if(!reader){const b=new Uint8Array(await response.arrayBuffer());if(b.byteLength>limit)throw new Error("Recurso demasiado grande");return b}
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){try{await reader.cancel()}catch{};throw new Error("Recurso demasiado grande")}chunks.push(value)}
  const merged=new Uint8Array(size);let off=0;for(const c of chunks){merged.set(c,off);off+=c.byteLength}return merged
}
async function readLimited(response){
  const reader=response.body?.getReader();if(!reader)return (await response.text()).slice(0,MAX_BYTES);
  const chunks=[];let size=0;
  while(true){
    const {done,value}=await reader.read();if(done)break;size+=value.byteLength;chunks.push(value);
    if(size>=MAX_BYTES){try{await reader.cancel()}catch{}break}
  }
  const merged=new Uint8Array(Math.min(size,MAX_BYTES));let off=0;
  for(const c of chunks){const part=c.slice(0,Math.max(0,MAX_BYTES-off));merged.set(part,off);off+=part.byteLength;if(off>=MAX_BYTES)break}
  return new TextDecoder("utf-8",{fatal:false}).decode(merged);
}
export async function scanPublicUrl(raw){
  const initial=await validateTarget(raw);
  const robots=await checkRobots(initial);
  if(!robots.allowed){
    const e=new Error("El sitio no permite este rastreo según robots.txt");
    e.code="ROBOTS_DENIED";throw e;
  }
  const {r,current}=await safeFetch(initial.href);
  const type=(r.headers.get("content-type")||"").toLowerCase();
  if(type.includes("application/pdf")||current.pathname.toLowerCase().endsWith(".pdf")){
    const bytes=await readBytesLimited(r,MAX_PDF_BYTES);let parser;
    try{
      const { PDFParse }=await import("pdf-parse");parser=new PDFParse({data:bytes});const result=await parser.getText();const text=String(result?.text||"").slice(0,150000);
      if(!text.trim())throw new Error("El PDF no contiene texto extraíble");
      const contentHash=createHash("sha256").update(text,"utf8").digest("hex"),name=decodeURIComponent(current.pathname.split("/").pop()||current.hostname);
      return {url:current.href,domain:current.hostname.replace(/^www\./,""),status:r.status,title:name,description:`PDF · ${result?.total||"?"} páginas`,technologies:["PDF"],externalLinks:[],internalLinks:[],externalCount:0,internalCount:0,totalAnchors:0,text,contentHash,resourceType:"pdf",scannedAt:new Date().toISOString(),bytes:bytes.byteLength}
    }finally{try{await parser?.destroy()}catch{}}
  }
  if(type.startsWith("text/plain")||type.includes("application/json")||type.includes("application/xml")||type.includes("text/xml")||type.includes("text/markdown")){
    const raw=await readLimited(r),text=raw.slice(0,100000),contentHash=createHash("sha256").update(text,"utf8").digest("hex"),name=decodeURIComponent(current.pathname.split("/").pop()||current.hostname);
    return {url:current.href,domain:current.hostname.replace(/^www\./,""),status:r.status,title:name,description:type.split(";")[0]||"Documento de texto",technologies:[],externalLinks:[],internalLinks:[],externalCount:0,internalCount:0,totalAnchors:0,text,contentHash,resourceType:"text",scannedAt:new Date().toISOString(),bytes:raw.length}
  }
  if(!type.includes("text/html")&&!type.includes("application/xhtml+xml")){const e=new Error("Tipo de recurso no compatible");e.code="UNSUPPORTED_TYPE";throw e}
  const html=await readLimited(r),links=extractLinks(html,current.href);
  const text=extractReadableText(html).slice(0,100000);
  const contentHash=createHash("sha256").update(text,"utf8").digest("hex");
  return {url:current.href,domain:current.hostname.replace(/^www\./,""),status:r.status,title:getTitle(html)||current.hostname,description:getDescription(html),technologies:detectTech(html,r.headers,current),...links,text,contentHash,resourceType:"html",scannedAt:new Date().toISOString(),bytes:html.length};
}
