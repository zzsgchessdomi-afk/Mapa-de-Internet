import json, sys, os

def out(stage, ok, detail):
    print(json.dumps({"stage":stage,"ok":ok,"detail":detail},ensure_ascii=False))

try:
    out("python", sys.version_info >= (3,11), sys.version.split()[0])
    import crewai
    out("crewai", True, getattr(crewai,"__version__","imported"))
except Exception as e:
    out("crewai", False, str(e))

try:
    from gpt_researcher import GPTResearcher
    out("gpt_researcher", True, "GPTResearcher import OK")
except Exception as e:
    out("gpt_researcher", False, str(e))

try:
    from crewai import LLM
    base=os.environ.get("ATLAS_LLM_BASE_URL","").strip()
    model=os.environ.get("ATLAS_MODEL","atlas-auto").strip() or "atlas-auto"
    if not base:
        out("crewai_llm", True, f"{model} -> cloud provider selected at runtime")
    else:
        lowered=base.lower()
        forbidden=("localhost","127.0.0.1","0.0.0.0","::1")
        if any(host in lowered for host in forbidden):
            raise RuntimeError("Local/loopback LLM endpoints are forbidden in Atlanex")
        llm=LLM(model=f"openai/{model}",custom_openai=True,base_url=base,api_key=os.environ.get("ATLAS_LLM_API_KEY","atlas-user-pays"))
        out("crewai_llm", True, f"{model} -> cloud endpoint configured")
except Exception as e:
    out("crewai_llm", False, str(e))
