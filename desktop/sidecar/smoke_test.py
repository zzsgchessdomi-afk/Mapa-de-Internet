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
    base=os.environ.get("ATLAS_LLM_BASE_URL","http://127.0.0.1:8788/v1")
    model=os.environ.get("ATLAS_MODEL","atlas-auto")
    llm=LLM(model=f"openai/{model}",custom_openai=True,base_url=base,api_key="atlas-user-pays")
    out("crewai_llm", True, f"{model} -> {base}")
except Exception as e:
    out("crewai_llm", False, str(e))
