const API_CATALOG="https://public-api-lists.github.io/public-api-lists/api/all.json";
const UA="Mozilla/5.0 (compatible; InternetAtlas/1.0; research client)";
function clean(s=""){return String(s).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()}
function safeHttpUrl(value){
 try{const u=new URL(String(value||""));return ["http:","https:"].includes(u.protocol)?u.href:""}catch{return ""}
}
function normalizeResult(r){
 const url=safeHttpUrl(r?.url);if(!url)return null;
 const title=clean(r?.title||"").slice(0,300);if(!title)return null;
 return {...r,url,title,description:clean(r?.description).slice(0,520),meta:Array.isArray(r?.meta)?r.meta.map(x=>clean(x).slice(0,160)).filter(Boolean).slice(0,8):[]}
}
function decodeHtml(s=""){return String(s).replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&#x27;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))}
async function getJson(url,headers={}){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),10000);
 try{const r=await fetch(url,{signal:c.signal,headers:{"User-Agent":UA,...headers}});if(!r.ok)throw new Error("HTTP "+r.status);return await r.json()}finally{clearTimeout(t)}
}
async function getText(url,headers={}){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),10000);
 try{const r=await fetch(url,{signal:c.signal,headers:{"User-Agent":UA,"Accept":"text/html,application/atom+xml,text/plain;q=0.8,*/*;q=0.3",...headers}});if(!r.ok)throw new Error("HTTP "+r.status);return (await r.text()).slice(0,2_000_000)}finally{clearTimeout(t)}
}
function alias(q){const m={ajedrez:"chess",finanzas:"finance",clima:"weather",seguridad:"web security","ia":"artificial intelligence","inteligencia artificial":"artificial intelligence"};return m[q.toLowerCase().trim()]||q}
function apiMatch(entries,q){
 const terms=q.toLowerCase().split(/\s+/).filter(Boolean),syn={chess:["chess"],finance:["finance","currency","cryptocurrency"],weather:["weather","environment"],security:["security","anti-malware"],video:["video","photography","machine learning"],artificial:["machine learning"],intelligence:["machine learning"]},all=new Set(terms);
 for(const t of terms)for(const s of syn[t]||[])all.add(s);
 return entries.map((x,i)=>({x,i,score:[...all].reduce((n,t)=>n+((x.name+" "+x.description+" "+x.category).toLowerCase().includes(t)?1:0),0)})).filter(o=>o.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(o=>({id:"api-"+o.i,source:"publicapis",type:"api",title:o.x.name,url:o.x.url,description:o.x.description||"",meta:[o.x.category,o.x.auth,o.x.https?"HTTPS":"HTTP","CORS "+o.x.cors],rawScore:o.score}))
}
function ddgTarget(href){
 try{
  const u=new URL(decodeHtml(href),"https://html.duckduckgo.com");
  const v=u.searchParams.get("uddg");if(v)return decodeURIComponent(v);
  if(u.hostname.includes("duckduckgo.com"))return null;
  return u.href
 }catch{return null}
}
function parseDuckDuckGo(html,q){
 const out=[];const re=/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m,i=0;
 while((m=re.exec(html))&&out.length<14){
  const url=ddgTarget(m[1]);if(!url||!/^https?:/i.test(url))continue;
  const tail=html.slice(re.lastIndex,re.lastIndex+2600),sm=tail.match(/(?:result__snippet[^>]*>|result-snippet[^>]*>)([\s\S]*?)(?:<\/a>|<\/div>|<\/td>)/i);
  out.push({id:"web-"+(i++),source:"websearch",type:"web",title:clean(decodeHtml(m[2]))||new URL(url).hostname,url,description:clean(decodeHtml(sm?.[1]||"Web search result")),meta:["DuckDuckGo","discovery"],rawScore:14-i})
 }
 return out
}
async function duckSearch(q){
 const html=await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,{"Content-Type":"application/x-www-form-urlencoded"});return parseDuckDuckGo(html,q)
}
async function stackSearch(q){
 const d=await getJson(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=6&filter=default`);
 return(d.items||[]).map(x=>({id:"so-"+x.question_id,source:"stackoverflow",type:"discussion",title:decodeHtml(x.title||"Stack Overflow"),url:x.link,description:`${x.answer_count||0} respuestas · score ${x.score||0}`,meta:[...(x.tags||[]).slice(0,3)],rawScore:(x.score||0)+(x.answer_count||0)*2}))
}
async function crossrefSearch(q){
 const d=await getJson(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}&rows=6&select=DOI,title,URL,published-print,published-online,is-referenced-by-count,container-title`);
 return(d.message?.items||[]).map((x,i)=>({id:"cr-"+(x.DOI||i),source:"crossref",type:"research",title:Array.isArray(x.title)?x.title[0]:x.title||x.DOI||"Crossref work",url:x.URL||("https://doi.org/"+x.DOI),description:Array.isArray(x["container-title"])?x["container-title"][0]||"Trabajo académico":"Trabajo académico",meta:[x.DOI||"DOI",String(x["is-referenced-by-count"]||0)+" referencias"],rawScore:x["is-referenced-by-count"]||0}))
}
function atomValue(block,tag){const m=block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,`i`));return clean(decodeHtml(m?.[1]||""))}
async function arxivSearch(q){
 const xml=await getText(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=6&sortBy=relevance&sortOrder=descending`);const out=[];for(const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)){const b=m[1],id=atomValue(b,"id"),title=atomValue(b,"title"),summary=atomValue(b,"summary"),published=atomValue(b,"published");if(id)out.push({id:"ax-"+id.split("/").pop(),source:"arxiv",type:"research",title:title||"arXiv paper",url:id,description:summary.slice(0,420),meta:[published.slice(0,10)||"paper"],rawScore:1})}return out
}
export default async function handler(req,res){
 const raw=Array.isArray(req.query?.q)?req.query.q[0]:req.query?.q;if(!raw||String(raw).trim().length<2)return res.status(400).json({error:"Falta q"});
 const q=alias(String(raw).trim().slice(0,220)),enc=encodeURIComponent(q),out=[],diagnostics=[];
 const requestStarted=Date.now(),MIN_USEFUL_RESULTS=1;
 const providers=[
  ["web",async()=>duckSearch(q)],
  ["wikipedia",async()=>{const d=await getJson(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${enc}&limit=6&namespace=0&format=json&origin=*`);return(d[1]||[]).map((t,i)=>({id:"wp-"+i,source:"wikipedia",type:"knowledge",title:t,url:d[3][i],description:d[2][i]||"Artículo Wikipedia",meta:["encyclopedia"]}))}],
  ["wikidata",async()=>{const d=await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc}&language=es&uselang=es&limit=6&format=json&origin=*`);return(d.search||[]).map(x=>({id:"wd-"+x.id,source:"wikidata",type:"entity",title:x.label||x.id,url:"https://www.wikidata.org/wiki/"+x.id,description:x.description||"Entidad Wikidata",meta:[x.id]}))}],
  ["github",async()=>{const d=await getJson(`https://api.github.com/search/repositories?q=${enc}&sort=stars&order=desc&per_page=6`,{"Accept":"application/vnd.github+json"});return(d.items||[]).map(x=>({id:"gh-"+x.id,source:"github",type:"code",title:x.full_name,url:x.html_url,description:x.description||"Repositorio GitHub",meta:[x.language||"code",(x.stargazers_count||0)+" ★"],rawScore:x.stargazers_count||0}))}],
  ["stackoverflow",async()=>stackSearch(q)],
  ["hackernews",async()=>{const d=await getJson(`https://hn.algolia.com/api/v1/search?query=${enc}&tags=story&hitsPerPage=6`);return(d.hits||[]).map(x=>({id:"hn-"+x.objectID,source:"hackernews",type:"discussion",title:x.title||"Hacker News",url:x.url||("https://news.ycombinator.com/item?id="+x.objectID),description:"Discusión o noticia",meta:[(x.points||0)+" puntos"],rawScore:x.points||0}))}],
  ["npm",async()=>{const d=await getJson(`https://registry.npmjs.org/-/v1/search?text=${enc}&size=6`);return(d.objects||[]).map(x=>({id:"npm-"+x.package.name,source:"npm",type:"package",title:x.package.name,url:x.package.links?.npm||("https://www.npmjs.com/package/"+x.package.name),description:x.package.description||"Paquete npm",meta:[x.package.version||"package"],rawScore:x.score?.final||0}))}],
  ["openalex",async()=>{const d=await getJson(`https://api.openalex.org/works?search=${enc}&per-page=6`);return(d.results||[]).map(x=>({id:"oa-"+x.id.split("/").pop(),source:"openalex",type:"research",title:x.display_name,url:x.doi||x.id,description:(x.publication_year?"Trabajo académico · "+x.publication_year:"Trabajo académico"),meta:[String(x.cited_by_count||0)+" citas"],rawScore:x.cited_by_count||0}))}],
  ["crossref",async()=>crossrefSearch(q)],
  ["arxiv",async()=>arxivSearch(q)],
  ["publicapis",async()=>{const d=await getJson(API_CATALOG);const entries=(d.entries||[]).map(x=>({name:x.name||x.API,url:x.url||x.Link,description:x.description||x.Description||"",auth:x.auth||x.Auth||"Unknown",https:x.https!==undefined?!!x.https:/yes/i.test(x.HTTPS||""),cors:x.cors||x.Cors||x.CORS||"Unknown",category:x.category||x.Category||"Other"})).filter(x=>x.name&&x.url);return apiMatch(entries,q)}]
 ];
 await Promise.all(providers.map(async([name,fn])=>{const started=Date.now();try{const rows=await fn();if(!Array.isArray(rows))throw new Error("Respuesta inválida: se esperaba una lista");out.push(...rows);diagnostics.push({provider:name,ok:true,count:rows.length,ms:Date.now()-started,state:rows.length?"results":"empty"})}catch(e){const aborted=e?.name==="AbortError";diagnostics.push({provider:name,ok:false,count:0,ms:Date.now()-started,state:aborted?"timeout":"error",error:(aborted?"Timeout de proveedor":String(e?.message||e)).slice(0,120)})}}));
 const seen=new Set(),results=[];for(const rawResult of out){const r=normalizeResult(rawResult);if(!r)continue;const k=(r.url+"|"+r.title).toLowerCase().replace(/\/$/,"");if(seen.has(k))continue;seen.add(k);results.push(r)}
 results.sort((a,b)=>(b.rawScore||0)-(a.rawScore||0));
 res.setHeader("Cache-Control","s-maxage=60, stale-while-revalidate=180");const successfulProviders=diagnostics.filter(x=>x.ok),providersWithResults=successfulProviders.filter(x=>x.count>0);
 const failedProviders=diagnostics.filter(x=>!x.ok),timedOutProviders=diagnostics.filter(x=>x.state==="timeout");
 const degraded=failedProviders.length>0||providersWithResults.length<3;
 const usable=results.length>=MIN_USEFUL_RESULTS;
 const status=usable?(degraded?"partial":"ok"):"no-results";
 res.status(200).json({query:q,status,usable,degraded,durationMs:Date.now()-requestStarted,providerCount:successfulProviders.length,providersWithResults:providersWithResults.length,failedProviders:failedProviders.length,timedOutProviders:timedOutProviders.length,diagnostics,results:results.slice(0,90),evidence:{discovered:results.length,verifiedSnapshots:0,note:"Discovery results are not verified evidence until inspected and content-hashed."},recovery:usable?(degraded?"Partial provider failure: results remain usable as discovery only.":"All provider paths healthy."):"No provider returned usable discovery results; do not synthesize or fabricate fallback results."});
}
