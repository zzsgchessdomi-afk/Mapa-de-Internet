import os,sys,json,uuid,time,asyncio,threading,traceback
from pathlib import Path
from importlib import metadata as importlib_metadata
from typing import Any,Dict

RUNS:Dict[str,Dict[str,Any]]={}
CANCELLED=set()
MODEL=os.getenv("ATLAS_MODEL","gemini-2.5-flash")
GEMINI_KEY=(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or "").strip()
CONFIG_PATH=Path(__file__).with_name("gptr_config.json")
RPC_PREFIX="ATLAS_RPC "

def pkg_version(name):
    try:return importlib_metadata.version(name)
    except:return None

def normalized_model():
    m=str(MODEL or "gemini-2.5-flash")
    for prefix in ("google_genai:","gemini/","models/"):
        if m.startswith(prefix):m=m[len(prefix):]
    return m or "gemini-2.5-flash"

def health_payload():
    crew=gptr=False;errs=[]
    try:import crewai;crew=True
    except Exception as e:errs.append("crewai: "+str(e))
    try:import gpt_researcher;gptr=True
    except Exception as e:errs.append("gpt_researcher: "+str(e))
    return {
        "ready":crew and gptr and bool(GEMINI_KEY),
        "runtime_ready":crew and gptr,
        "crewai":crew,"crewai_version":pkg_version("crewai"),
        "gpt_researcher":gptr,"gpt_researcher_version":pkg_version("gpt-researcher"),
        "python":sys.version.split()[0],"python_executable":sys.executable,
        "transport":"stdio","provider":"gemini","model":normalized_model(),
        "gemini_configured":bool(GEMINI_KEY),
        "message":"; ".join(errs) if errs else ("ready" if GEMINI_KEY else "Gemini API key required")
    }

def emit(rid,stage,message,status=None,progress=None):
    r=RUNS[rid];r["events"].append({"at":time.time(),"stage":stage,"message":message})
    if stage in r["stages"] and status:r["stages"][stage]={"status":status,"detail":message[:160]}
    if progress is not None:r["progress"]=progress

def ensure_not_cancelled(rid):
    if rid in CANCELLED:raise RuntimeError("cancelled")

async def network_probe():
    import httpx
    urls={"github":"https://api.github.com","wikipedia":"https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*","duckduckgo":"https://duckduckgo.com/"}
    out={}
    async with httpx.AsyncClient(timeout=15,follow_redirects=True,headers={"User-Agent":"Atlanex"}) as c:
        for name,url in urls.items():
            try:
                r=await c.get(url);out[name]={"ok":r.status_code<500,"status":r.status_code}
            except Exception as e:out[name]={"ok":False,"error":str(e)}
    return out

async def gemini_probe():
    if not GEMINI_KEY:return {"ok":False,"detail":"Gemini API key not configured"}
    import httpx
    try:
        url="https://generativelanguage.googleapis.com/v1beta/models"
        async with httpx.AsyncClient(timeout=20) as c:
            r=await c.get(url,params={"key":GEMINI_KEY})
        return {"ok":r.status_code==200,"detail":"Gemini reachable" if r.status_code==200 else f"HTTP {r.status_code}"}
    except Exception as e:return {"ok":False,"detail":str(e)}

async def doctor_payload():
    h=health_payload();n=await network_probe();g=await gemini_probe()
    checks={
        "python":{"ok":sys.version_info>=(3,11),"detail":sys.version.split()[0]},
        "crewai":{"ok":h["crewai"],"detail":h.get("crewai_version") or "missing"},
        "gpt_researcher":{"ok":h["gpt_researcher"],"detail":h.get("gpt_researcher_version") or "missing"},
        "transport":{"ok":True,"detail":"stdio JSON-RPC; no loopback server"},
        "gemini":g,**n
    }
    return {"ready":all(v.get("ok") for v in checks.values()),"checks":checks,"health":h}

class AtlasGeminiLLM:
    def __new__(cls,*args,**kwargs):
        from crewai.llms.base_llm import BaseLLM
        class _Impl(BaseLLM):
            def __init__(self,model,api_key,temperature=0.1):
                super().__init__(model=model,temperature=temperature)
                self.api_key=api_key
            def call(self,messages,tools=None,callbacks=None,available_functions=None,**kwargs):
                if not self.api_key:raise RuntimeError("Gemini API key not configured")
                import httpx
                msgs=messages if isinstance(messages,list) else [{"role":"user","content":str(messages)}]
                system=[];contents=[]
                for msg in msgs:
                    role=str(msg.get("role","user"))
                    content=msg.get("content","")
                    if isinstance(content,list):
                        content="\n".join(str(x.get("text",x)) if isinstance(x,dict) else str(x) for x in content)
                    text=str(content)
                    if role=="system":system.append(text);continue
                    contents.append({"role":"model" if role=="assistant" else "user","parts":[{"text":text}]})
                payload={"contents":contents or [{"role":"user","parts":[{"text":""}]}],"generationConfig":{"temperature":self.temperature if self.temperature is not None else 0.1}}
                if system:payload["system_instruction"]={"parts":[{"text":"\n\n".join(system)}]}
                url=f"https://generativelanguage.googleapis.com/v1beta/models/{normalized_model()}:generateContent"
                r=httpx.post(url,params={"key":self.api_key},json=payload,timeout=180)
                if r.status_code>=400:raise RuntimeError(f"Gemini HTTP {r.status_code}: {r.text[:500]}")
                data=r.json();parts=((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
                text="".join(str(x.get("text","")) for x in parts if isinstance(x,dict)).strip()
                if not text:raise RuntimeError("Gemini returned an empty response")
                return text
            def supports_function_calling(self):return False
            def supports_stop_words(self):return False
            def get_context_window_size(self):return 1000000
        return _Impl(model=normalized_model(),api_key=GEMINI_KEY,temperature=kwargs.get("temperature",0.1))

def atlas_llm():
    return AtlasGeminiLLM(temperature=0.1)

def configure_gptr():
    if not GEMINI_KEY:raise RuntimeError("Gemini API key not configured")
    model=normalized_model()
    os.environ["GOOGLE_API_KEY"]=GEMINI_KEY
    os.environ["GEMINI_API_KEY"]=GEMINI_KEY
    os.environ["FAST_LLM"]=f"google_genai:{model}"
    os.environ["SMART_LLM"]=f"google_genai:{model}"
    os.environ["STRATEGIC_LLM"]=f"google_genai:{model}"
    os.environ["EMBEDDING"]="google_genai:models/gemini-embedding-001"

def smoke_payload():
    h=health_payload()
    if not h["runtime_ready"]:return {"ok":False,"stage":"imports","health":h}
    try:
        from crewai.llms.base_llm import BaseLLM
        from gpt_researcher import GPTResearcher
        import langchain_google_genai
        llm=atlas_llm()
        return {
            "ok":True,"stage":"runtime",
            "crewai_llm":isinstance(llm,BaseLLM),
            "gpt_researcher_class":GPTResearcher is not None,
            "google_genai_adapter":langchain_google_genai is not None,
            "provider":"gemini","transport":"stdio",
            "gemini_configured":bool(GEMINI_KEY)
        }
    except Exception as e:return {"ok":False,"stage":"runtime","error":str(e)}

def start_run_obj(payload):
    objective=str(payload.get("objective") or "").strip()
    if not objective:raise ValueError("objective required")
    mode=str(payload.get("mode") or "hybrid")
    context=payload.get("context") if isinstance(payload.get("context"),dict) else {}
    rid=str(uuid.uuid4())
    RUNS[rid]={"id":rid,"status":"queued","progress":0,"objective":objective,"mode":mode,
               "context":context,"result":None,"error":None,"events":[],
               "stages":{x:{"status":"queued","detail":""} for x in ["planner","researcher","verifier","analyst","publisher"]}}
    threading.Thread(target=run_pipeline_sync,args=(rid,objective,mode,context),daemon=True).start()
    return {"run_id":rid}

def get_run_obj(rid):
    r=RUNS.get(str(rid))
    if not r:raise KeyError("run not found")
    return r

def cancel_run_obj(rid):
    rid=str(rid)
    if rid not in RUNS:raise KeyError("run not found")
    CANCELLED.add(rid);RUNS[rid]["status"]="cancelled"
    return {"ok":True}

def crew_plan(rid,objective,context):
    from crewai import Agent,Task,Crew,Process
    a=Agent(role="Research Planner",goal="Create a compact evidence-first research plan.",backstory="You plan verifiable research.",llm=atlas_llm(),verbose=False,allow_delegation=False,max_iter=2)
    t=Task(description=f"Objective: {objective}\nAtlas context: {json.dumps(context,ensure_ascii=False)[:6000]}\nReturn verification questions and primary-source priorities.",expected_output="A concise evidence-first plan.",agent=a)
    return str(Crew(agents=[a],tasks=[t],process=Process.sequential,verbose=False).kickoff())

def gpt_research(rid,objective,plan):
    from gpt_researcher import GPTResearcher
    configure_gptr()
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
        if not GEMINI_KEY:raise RuntimeError("Configure Gemini API key in Atlanex Desktop before running agents")
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

def runtime_self_test(deep=False):
    h=health_payload()
    out={"ok":False,"deep":bool(deep),"health":h,"crewai_runtime":False,"gpt_researcher_runtime":False,
         "google_genai_adapter":False,"stdio_rpc":True,"no_loopback_runtime":True}
    try:
        from crewai import Agent,Task,Crew,Process
        from crewai.llms.base_llm import BaseLLM
        class StubLLM(BaseLLM):
            def call(self,messages,tools=None,callbacks=None,available_functions=None,**kwargs):
                return "Final Answer: Atlanex CrewAI runtime is operational."
            def supports_function_calling(self):return False
            def supports_stop_words(self):return False
            def get_context_window_size(self):return 8192
        a=Agent(role="Atlanex Runtime Tester",goal="Return a short validation.",backstory="Runtime test agent.",llm=StubLLM(model="atlanex-stub"),verbose=False,allow_delegation=False,max_iter=1)
        t=Task(description="Confirm the runtime is operational.",expected_output="One short validation sentence.",agent=a)
        result=str(Crew(agents=[a],tasks=[t],process=Process.sequential,verbose=False).kickoff())
        if not result.strip():raise RuntimeError("CrewAI returned empty output")
        out["crewai_runtime"]=True
        from gpt_researcher import GPTResearcher
        out["gpt_researcher_runtime"]=GPTResearcher is not None
        import langchain_google_genai
        out["google_genai_adapter"]=langchain_google_genai is not None
        if deep:
            from langchain_google_genai import ChatGoogleGenerativeAI,GoogleGenerativeAIEmbeddings
            chat=ChatGoogleGenerativeAI(model="gemini-2.5-flash",google_api_key="test-key")
            emb=GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001",google_api_key="test-key")
            out["provider_objects"]=bool(chat and emb)
        out["ok"]=out["crewai_runtime"] and out["gpt_researcher_runtime"] and out["google_genai_adapter"] and (out.get("provider_objects",True) if deep else True)
    except Exception as e:
        out["error"]=str(e);out["traceback"]=traceback.format_exc()[-7000:]
    return out

def rpc_dispatch(method,params):
    if method=="health":return health_payload()
    if method=="doctor":return asyncio.run(doctor_payload())
    if method=="smoke":return smoke_payload()
    if method=="runs.start":return start_run_obj(params or {})
    if method=="runs.get":return get_run_obj((params or {}).get("run_id"))
    if method=="runs.cancel":return cancel_run_obj((params or {}).get("run_id"))
    if method=="ping":return {"ok":True,"transport":"stdio"}
    raise ValueError("unknown RPC method: "+str(method))

def rpc_send(obj):
    sys.__stdout__.write(RPC_PREFIX+json.dumps(obj,ensure_ascii=False,separators=(",",":"))+"\n")
    sys.__stdout__.flush()

def stdio_main():
    for raw in sys.stdin:
        raw=raw.strip()
        if not raw:continue
        rid=None
        try:
            req=json.loads(raw);rid=req.get("id")
            result=rpc_dispatch(req.get("method"),req.get("params") or {})
            rpc_send({"id":rid,"ok":True,"result":result})
        except Exception as e:
            rpc_send({"id":rid,"ok":False,"error":str(e),"type":type(e).__name__})
    return 0

if __name__=="__main__":
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument("--stdio",action="store_true")
    p.add_argument("--self-test",action="store_true")
    p.add_argument("--self-test-deep",action="store_true")
    a=p.parse_args()
    if a.self_test or a.self_test_deep:
        result=runtime_self_test(deep=a.self_test_deep)
        print(json.dumps(result,ensure_ascii=False))
        sys.exit(0 if result.get("ok") else 2)
    if not a.stdio:
        print(json.dumps({"ok":False,"error":"Atlanex Agent Engine requires --stdio transport"}))
        sys.exit(2)
    sys.exit(stdio_main())
