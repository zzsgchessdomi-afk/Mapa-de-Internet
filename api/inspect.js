import { scanPublicUrl } from "../lib/scanner.js";
export default async function handler(req,res){
 try{
  const raw=Array.isArray(req.query?.url)?req.query.url[0]:req.query?.url;if(!raw)return res.status(400).json({error:"Falta url"});
  const d=await scanPublicUrl(raw);
  const links=[
    ...(d.internalLinks||[]).map(x=>x.url),
    ...(d.externalLinks||[]).map(x=>x.url)
  ].slice(0,120);
  const snapshot={
    id:`sha256:${d.contentHash}`,
    url:d.url,
    title:d.title,
    text:d.text||"",
    contentHash:d.contentHash,
    fetchedAt:d.scannedAt,
    httpStatus:d.status,
    extractor:d.resourceType==="pdf"?"atlas-pdf":d.resourceType==="text"?"atlas-text":"atlas-safe-html",
    bytes:d.bytes||0
  };
  res.setHeader("Cache-Control","no-store");
  res.status(200).json({
    url:d.url,title:d.title,description:d.description,technologies:d.technologies||[],
    links,status:d.status,text:d.text||"",contentHash:d.contentHash,fetchedAt:d.scannedAt,resourceType:d.resourceType||"html",
    snapshot
  });
 }catch(e){res.status(502).json({error:String(e?.message||e).slice(0,260)})}
}