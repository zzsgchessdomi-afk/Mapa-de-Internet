import handler from '../api/research.js';
const originalFetch=globalThis.fetch;
function J(obj,status=200){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json'}})}
function T(text,status=200,ct='text/html'){return new Response(text,{status,headers:{'Content-Type':ct}})}
globalThis.fetch=async (input)=>{
 const u=String(input);
 if(u.includes('html.duckduckgo.com'))return T('<div class="result"><a class="result__a" href="https://example.com/product">Example Product</a><a class="result__snippet">Official pricing and API docs</a></div>');
 if(u.includes('wikipedia.org/w/api.php'))return J(['q',['Example'],['Example article'],['https://en.wikipedia.org/wiki/Example']]);
 if(u.includes('wikidata.org/w/api.php'))return J({search:[{id:'Q1',label:'Example',description:'entity'}]});
 if(u.includes('api.github.com/search/repositories'))return J({items:[{id:1,full_name:'org/example',html_url:'https://github.com/org/example',description:'repo',language:'JS',stargazers_count:42}]});
 if(u.includes('api.stackexchange.com'))return J({items:[{question_id:2,title:'Example API question',link:'https://stackoverflow.com/q/2',answer_count:3,score:5,tags:['api']}]});
 if(u.includes('hn.algolia.com'))return J({hits:[{objectID:'3',title:'Example launch',url:'https://news.example.com/launch',points:10}]});
 if(u.includes('registry.npmjs.org'))return J({objects:[{package:{name:'example',description:'pkg',version:'1.0.0',links:{npm:'https://www.npmjs.com/package/example'}},score:{final:.8}}]});
 if(u.includes('api.openalex.org'))return J({results:[{id:'https://openalex.org/W1',display_name:'Example Research',doi:'https://doi.org/10.1/example',publication_year:2026,cited_by_count:7}]});
 if(u.includes('api.crossref.org'))return J({message:{items:[{DOI:'10.1/example2',title:['Crossref Example'],URL:'https://doi.org/10.1/example2','container-title':['Journal'],'is-referenced-by-count':4}]}});
 if(u.includes('export.arxiv.org'))return T('<?xml version="1.0"?><feed><entry><id>https://arxiv.org/abs/2601.00001</id><title>Arxiv Example</title><summary>Research summary</summary><published>2026-01-01T00:00:00Z</published></entry></feed>',200,'application/atom+xml');
 if(u.includes('public-api-lists.github.io'))return J({entries:[{name:'Example API',url:'https://api.example.com',description:'API example',auth:'apiKey',https:true,cors:'yes',category:'Development'}]});
 throw new Error('unexpected URL '+u)
};
const req={query:{q:'example api'}};
let code=200,body=null,headers={};
const res={status(n){code=n;return this},setHeader(k,v){headers[k]=v;return this},json(x){body=x;return this}};
await handler(req,res);
globalThis.fetch=originalFetch;
if(code!==200)throw new Error('status '+code);
if(!Array.isArray(body?.results)||body.results.length<8)throw new Error('too few results: '+body?.results?.length);
for(const source of ['websearch','wikipedia','wikidata','github','stackoverflow','npm','openalex','crossref','arxiv']){
 if(!body.results.some(x=>x.source===source))throw new Error('missing source '+source)
}
if((body.providerCount||0)<9)throw new Error('providerCount '+body.providerCount);
console.log(JSON.stringify({ok:true,providerCount:body.providerCount,results:body.results.length,sources:[...new Set(body.results.map(x=>x.source))]},null,2));
