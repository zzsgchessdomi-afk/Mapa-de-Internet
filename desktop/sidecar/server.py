import os,sys,json,uuid,time,asyncio,threading,traceback,tempfile,socket
from pathlib import Path
from importlib import metadata as importlib_metadata
from typing import Any,Dict
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

APP=FastAPI(title="Atlas Agent Sidecar",version="29.1")
RUNS:Dict[str,Dict[str,Any]]={}
CANCELLED=set()
BRIDGE=os.getenv("ATLAS_LLM_BASE_URL","http://127.0.0.1:8788/v1").rstrip("/")
MODEL=os.getenv("ATLAS_MODEL","gpt-5.6-luna")
CONFIG_PATH=Path(__file__).with_name("gptr_config.json")

def pkg_version(name):
    try:return importlib_metadata.version(name)
    except:return None

def health_payload():
    crew=gptr=False;errs=[]
    try:import crewai;crew=True
    except Exception as e:errs.append("crewai: "+str(e))
    try:import gpt_researcher;gptr=True
    except Exception as e:errs.append("gpt_researcher: "+str(e))
    return {"ready":crew and gptr,"crewai":crew,"crewai_version":pkg_version("crewai"),
            "gpt_researcher":gptr,"gpt_researcher_version":pkg_version("gpt-researcher"),
            "fastapi_version":pkg_version("fastapi"),"python":sys.version.split()[0],
            "python_executable":sys.executable,"bridge":BRIDGE,
            "message":"; ".join(errs) if errs else "ready"}

def emit(rid,stage,message,status=None,progress=None):
    r=RUNS[rid];r["events"].append({"at":time.time(),"stage":stage,"message":message})
    if stage in r["stages"] and status:r["stages"][stage]={"status":status,"detail":message[:160]}
    if progress is not None:r["progress"]=progress

def ensure_not_cancelled(rid):
    if rid in CANCELLED:raise RuntimeError("cancelled")

async def bridge_probe():
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r=await c.get(BRIDGE.replace("/v1","")+"/v1/models")
            d=r.json() if r.status_code==200 else {}
            return {"ok":r.status_code==200,"detail":f"{len(d.get('data',[]))} modelos visibles" if r.status_code==200 else f"HTTP {r.status_code}"}
    except Exception as e:return {"ok":False,"detail":str(e)}

async def network_probe():
    import httpx
    urls={"github":"https://api.github.com","wikipedia":"https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*","duckduckgo":"https://duckduckgo.com/"}
    out={}
    async with httpx.AsyncClient(timeout=15,follow_redirects=True,headers={"User-Agent":"Internet-Atlas"}) as c:
        for name,url in urls.items():
            try:
                r=await c.get(url);out[name]={"ok":r.status_code<500,"status":r.status_code}
            except Exception as e:out[name]={"ok":False,"error":str(e)}
    return out

@APP.get("/health")
async def health():return health_payload()

@APP.get("/doctor")
async def doctor():
    h=health_payload();b=await bridge_probe();n=await network_probe()
    checks={"python":{"ok":sys.version_info>=(3,11),"detail":sys.version.split()[0]},
            "crewai":{"ok":h["crewai"],"detail":h.get("crewai_version") or "missing"},
            "gpt_researcher":{"ok":h["gpt_researcher"],"detail":h.get("gpt_researcher_version") or "missing"},
            "llm_bridge":b,**n}
    return {"ready":all(v.get("ok") for v in checks.values()),"checks":checks,"health":h}

def atlas_llm():
    from crewai import LLM
    return LLM(model=f"openai/{MODEL}",custom_openai=True,base_url=BRIDGE,api_key="atlas-user-pays",temperature=0.1)

@APP.post("/smoke")
async def smoke():
    h=health_payload()
    if not h["ready"]:return JSONResponse(status_code=503,content={"ok":False,"stage":"imports","health":h})
    try:
        from crewai import LLM
        from gpt_researcher import GPTResearcher
        llm=LLM(model=f"openai/{MODEL}",custom_openai=True,base_url=BRIDGE,api_key="atlas-user-pays",temperature=0.1)
        return {"ok":True,"stage":"runtime","crewai_llm":llm is not None,"gpt_researcher_class":GPTResearcher is not None}
    except Exception as e:return JSONResponse(status_code=500,content={"ok":False,"stage":"runtime","error":str(e)})

class StartRequest(BaseModel):
    objective:str
    mode:str="hybrid"
    context:dict={}

@APP.post("/runs")
async def start_run(req:StartRequest):
    rid=str(uuid.uuid4())
    RUNS[rid]={"id":rid,"status":"queued","progress":0,"objective":req.objective,"mode":req.mode,
               "context":req.context,"result":None,"error":None,"events":[],
               "stages":{x:{"status":"queued","detail":""} for x in ["planner","researcher","verifier","analyst","publisher"]}}
    threading.Thread(target=run_pipeline_sync,args=(rid,req.objective,req.mode,req.context),daemon=True).start()
    return {"run_id":rid}

@APP.get("/runs/{rid}")
async def get_run(rid:str):
    r=RUNS.get(rid)
    if not r:return JSONResponse(status_code=404,content={"error":"run not found"})
    return r

@APP.post("/runs/{rid}/cancel")
async def cancel_run(rid:str):
    if rid not in RUNS:return JSONResponse(status_code=404,content={"error":"run not found"})
    CANCELLED.add(rid);RUNS[rid]["status"]="cancelled"
    return {"ok":True}

def crew_plan(rid,objective,context):
    from crewai import Agent,Task,Crew,Process
    a=Agent(role="Research Planner",goal="Create a compact evidence-first research plan.",backstory="You plan verifiable research.",llm=atlas_llm(),verbose=False,allow_delegation=False,max_iter=2)
    t=Task(description=f"Objective: {objective}\nAtlas context: {json.dumps(context,ensure_ascii=False)[:6000]}\nReturn verification questions and primary-source priorities.",expected_output="A concise evidence-first plan.",agent=a)
    return str(Crew(agents=[a],tasks=[t],process=Process.sequential,verbose=False).kickoff())

def gpt_research(rid,objective,plan):
    from gpt_researcher import GPTResearcher
    os.environ["OPENAI_API_KEY"]="atlas-user-pays";os.environ["OPENAI_BASE_URL"]=BRIDGE
    os.environ["FAST_LLM"]=f"openai:{MODEL}";os.environ["SMART_LLM"]=f"openai:{MODEL}";os.environ["STRATEGIC_LLM"]=f"openai:{MODEL}"
    query=f"{objective}\n\nResearch plan:\n{plan}\n\nPrioritize official/primary sources. Preserve URLs. Mark uncertainty and contradictions. Do not invent missing facts."
    async def go():
        r=GPTResearcher(query=query,report_type="research_report",config_path=str(CONFIG_PATH))
        await r.conduct_research()
        return await r.write_report()
    return str(asyncio.run(go()))

def crew_review(rid,objective,report,context):
    from crewai import Agent,Task,Crew,Process
    llm=atlas_llm()
    verifier=Agent(role="Evidence Verifier",goal="Separate supported, provisional and missing claims.",backstory="You are skeptical and preserve citations.",llm=llm,verbose=False,allow_delegation=False,max_iter=2)
    analyst=Agent(role="Decision Analyst",goal="Explain tradeoffs and blockers from evidence.",backstory="You never invent scores.",llm=llm,verbose=False,allow_delegation=False,max_iter=2)
    publisher=Agent(role="Decision Publisher",goal="Write a concise Spanish research memo with sources.",backstory="You preserve uncertainty.",llm=llm,verbose=False,allow_delegation=False,max_iter=2)
    t1=Task(description=f"Objective: {objective}\nDeep research:\n{report[:28000]}\nAudit as VERIFIED/PROVISIONAL/CONTRADICTIONS/MISSING. Keep URLs.",expected_output="Evidence audit with URLs.",agent=verifier)
    t2=Task(description=f"Objective: {objective}\nAtlas context: {json.dumps(context,ensure_ascii=False)[:5000]}\nCompare tradeoffs and blockers. No invented scores.",expected_output="Decision analysis.",agent=analyst,context=[t1])
    t3=Task(description="Write final memo in Spanish: resumen, hallazgos respaldados, provisional, contradicciones, siguiente acción, fuentes.",expected_output="Spanish evidence-first decision memo.",agent=publisher,context=[t1,t2])
    return str(Crew(agents=[verifier,analyst,publisher],tasks=[t1,t2,t3],process=Process.sequential,verbose=False).kickoff())

def crew_only(objective,context):
    from crewai import Agent,Task,Crew,Process
    a=Agent(role="Evidence Research Team",goal="Analyze supplied Atlas evidence without inventing facts.",backstory="Evidence-first research.",llm=atlas_llm(),verbose=False,allow_delegation=False,max_iter=3)
    t=Task(description=f"Objective: {objective}\nAtlas context: {json.dumps(context,ensure_ascii=False)[:12000]}\nReturn a Spanish memo with supported facts, uncertainty, blockers and next verification steps.",expected_output="Spanish evidence memo.",agent=a)
    return str(Crew(agents=[a],tasks=[t],process=Process.sequential,verbose=False).kickoff())

def run_pipeline_sync(rid,objective,mode,context):
    r=RUNS[rid];r["status"]="running"
    try:
        ensure_not_cancelled(rid)
        if mode=="crew":
            emit(rid,"planner","CrewAI pipeline starting","running",10);result=crew_only(objective,context)
            for i,s in enumerate(["planner","researcher","verifier","analyst","publisher"]):emit(rid,s,f"{s} completed","done",20+i*18)
        else:
            emit(rid,"planner","Creating research plan","running",8);plan=crew_plan(rid,objective,context);emit(rid,"planner","Plan ready","done",20)
            ensure_not_cancelled(rid);emit(rid,"researcher","GPT Researcher deep pass","running",30);report=gpt_research(rid,objective,plan);emit(rid,"researcher","Deep research complete","done",65)
            ensure_not_cancelled(rid)
            if mode=="gptr":result=report;emit(rid,"publisher","Direct research report complete","done",98)
            else:
                emit(rid,"verifier","CrewAI evidence review","running",72);result=crew_review(rid,objective,report,context);emit(rid,"verifier","Evidence audit complete","done",84);emit(rid,"analyst","Analysis complete","done",93);emit(rid,"publisher","Memo complete","done",99)
        ensure_not_cancelled(rid);r["result"]=result;r["status"]="done";r["progress"]=100
    except Exception as e:
        if rid in CANCELLED:r["status"]="cancelled";r["error"]="cancelled"
        else:r["status"]="error";r["error"]=str(e);r["traceback"]=traceback.format_exc()[-12000:];emit(rid,"publisher","ERROR: "+str(e),"error",r.get("progress",0))

class _MockHandler(__import__("http.server").server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def _send(self,obj):
        raw=json.dumps(obj).encode();self.send_response(200);self.send_header("Content-Type","application/json");self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        if self.path.endswith("/models"):self._send({"object":"list","data":[{"id":"atlas-self-test","object":"model"}]})
        else:self._send({"ok":True})
    def do_POST(self):
        n=int(self.headers.get("Content-Length","0"));raw=self.rfile.read(n)
        try:b=json.loads(raw or b"{}")
        except:b={}
        if "embeddings" in self.path:
            arr=b.get("input",[]);arr=arr if isinstance(arr,list) else [arr];self._send({"object":"list","data":[{"object":"embedding","index":i,"embedding":[0.01]*384} for i,_ in enumerate(arr)],"model":"atlas-self-test"})
        else:
            messages=b.get("messages",[]);text="Atlas self-test response. Evidence is provisional unless backed by source snapshot."
            if any("report" in str(x).lower() for x in messages):text="Atlas local research report: the supplied local document states the test API has a free tier and commercial use is permitted. Source: local atlas-self-test.txt."
            self._send({"id":"self-test","object":"chat.completion","created":int(time.time()),"model":"atlas-self-test","choices":[{"index":0,"message":{"role":"assistant","content":text},"finish_reason":"stop"}]})

def _start_mock():
    from http.server import ThreadingHTTPServer
    s=ThreadingHTTPServer(("127.0.0.1",0),_MockHandler);threading.Thread(target=s.serve_forever,daemon=True).start();return s

def runtime_self_test(deep=False):
    global BRIDGE,MODEL
    h=health_payload();out={"ok":False,"deep":bool(deep),"health":h,"crewai_runtime":False,"gpt_researcher_runtime":False,"gpt_researcher_deep":False}
    if not h["ready"]:out["error"]="required packages are not importable";return out
    old_bridge,old_model=BRIDGE,MODEL;s=None
    try:
        s=_start_mock();BRIDGE=f"http://127.0.0.1:{s.server_address[1]}/v1";MODEL="atlas-self-test"
        os.environ["OPENAI_API_KEY"]="atlas-self-test";os.environ["OPENAI_BASE_URL"]=BRIDGE
        from crewai import Agent,Task,Crew,Process
        a=Agent(role="Atlas Runtime Tester",goal="Return a short successful validation.",backstory="Runtime test agent.",llm=atlas_llm(),verbose=False,allow_delegation=False,max_iter=1)
        t=Task(description="Say that the Atlas CrewAI runtime is operational.",expected_output="One short validation sentence.",agent=a)
        crew_result=str(Crew(agents=[a],tasks=[t],process=Process.sequential,verbose=False).kickoff())
        if not crew_result.strip():raise RuntimeError("CrewAI returned empty output")
        out["crewai_runtime"]=True
        from gpt_researcher import GPTResearcher
        with tempfile.TemporaryDirectory(prefix="atlas-self-test-") as td:
            doc=Path(td)/"atlas-self-test.txt";doc.write_text("Atlas test API documentation. Free tier available. Commercial use is permitted. No API key required.",encoding="utf-8")
            os.environ["DOC_PATH"]=td;os.environ["REPORT_SOURCE"]="local"
            r=GPTResearcher(query="Summarize the local Atlas test API document.",report_type="research_report",report_source="local",config_path=str(CONFIG_PATH))
            out["gpt_researcher_runtime"]=True
            if deep:
                async def go():
                    await r.conduct_research();return await r.write_report()
                report=str(asyncio.run(go()))
                if len(report.strip())<20:raise RuntimeError("GPT Researcher deep report was empty")
                out["gpt_researcher_deep"]=True;out["report_chars"]=len(report)
        out["ok"]=out["crewai_runtime"] and out["gpt_researcher_runtime"] and (out["gpt_researcher_deep"] if deep else True)
    except Exception as e:out["error"]=str(e);out["traceback"]=traceback.format_exc()[-7000:]
    finally:
        BRIDGE,MODEL=old_bridge,old_model
        try:s.shutdown();s.server_close()
        except:pass
    return out

if __name__=="__main__":
    # Frozen Windows builds may inherit a legacy console code page. Force UTF-8
    # so dependency log output cannot crash the acceptance/self-test process.
    for _stream in (sys.stdout, sys.stderr):
        try:_stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except Exception:pass
    import argparse,uvicorn
    p=argparse.ArgumentParser();p.add_argument("--port",type=int,default=int(os.getenv("PORT","8765")));p.add_argument("--self-test",action="store_true");p.add_argument("--self-test-deep",action="store_true");a=p.parse_args()
    if a.self_test or a.self_test_deep:
        result=runtime_self_test(deep=a.self_test_deep);print(json.dumps(result,ensure_ascii=False));sys.exit(0 if result.get("ok") else 2)
    uvicorn.run(APP,host="127.0.0.1",port=a.port,log_level="warning")
