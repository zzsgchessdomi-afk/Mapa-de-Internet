from __future__ import annotations
import importlib.metadata as md
import subprocess, sys, tempfile
from pathlib import Path

BASE = [
    "httpx>=0.28.1,<1",
    "crewai==1.15.22",
]
GEMINI_RUNTIME = [
    "langchain-google-genai>=2,<4",
]
GPTR = "gpt-researcher==0.15.1"
IGNORED_GPTR = {"json5","aiofiles","unstructured","unstructured-client"}
RUNTIME_OVERRIDES = ["json5>=0.12,<1","aiofiles~=24.1.0"]

def pip(*args: str) -> None:
    cmd=[sys.executable,"-m","pip",*args]
    print("+"," ".join(cmd),flush=True)
    subprocess.check_call(cmd)

def normalized(name: str) -> str:
    return name.lower().replace("_","-").replace(".","-")

def main() -> int:
    pip("install",*BASE)
    pip("install",GPTR,"--no-deps")
    from packaging.requirements import Requirement
    reqs=[]; skipped=[]
    for raw in md.requires("gpt-researcher") or []:
        req=Requirement(raw)
        if normalized(req.name) in IGNORED_GPTR:
            skipped.append(str(req)); continue
        if req.marker and not req.marker.evaluate({"extra":""}):
            continue
        reqs.append(str(req))
    print("Excluded unused document dependencies:",skipped,flush=True)
    with tempfile.TemporaryDirectory(prefix="atlanex-gptr-deps-") as td:
        p=Path(td)/"requirements.txt"
        p.write_text("\n".join(reqs)+"\n",encoding="utf-8")
        pip("install","-r",str(p))
    pip("install",*RUNTIME_OVERRIDES)
    pip("install",*GEMINI_RUNTIME)

    installed={normalized(d.metadata["Name"]) for d in md.distributions() if d.metadata.get("Name")}
    leaked=[p for p in ("unstructured","unstructured-client","spacy","numba","llvmlite") if normalized(p) in installed]
    if leaked:
        raise RuntimeError("Heavy optional document stack leaked into Atlanex runtime: "+repr(leaked))

    probe=(
        "import importlib.metadata as m; "
        "import httpx,crewai,gpt_researcher,pywintypes,langchain_google_genai; "
        "from crewai import Agent,Task,Crew,Process; "
        "from crewai.llms.base_llm import BaseLLM; "
        "from gpt_researcher import GPTResearcher; "
        "from langchain_google_genai import ChatGoogleGenerativeAI,GoogleGenerativeAIEmbeddings; "
        "print({k:m.version(k) for k in "
        "['httpx','crewai','gpt-researcher','json5','aiofiles','pywin32','langchain-google-genai']})"
    )
    subprocess.check_call([sys.executable,"-c",probe])
    return 0

if __name__=="__main__":
    raise SystemExit(main())
