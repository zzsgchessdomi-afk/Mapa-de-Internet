from __future__ import annotations
import importlib.metadata as md
import subprocess, sys, tempfile
from pathlib import Path

BASE = [
    "fastapi>=0.115,<1",
    "uvicorn[standard]>=0.30,<1",
    "httpx>=0.28.1,<1",
    "crewai==1.15.22",
    # GPT Researcher 0.15.1's DuckDuckGo retriever imports the renamed
    # ddgs package at runtime, but its published metadata does not reliably
    # install it. Pin it explicitly so Windows builds are reproducible.
    "ddgs==9.16.0",
]
GPTR = "gpt-researcher==0.15.1"
# json5 is shared by both engines. GPT Researcher requires >=0.12, so use that
# and validate CrewAI's Atlas execution path explicitly instead of knowingly
# shipping an environment that pip reports as inconsistent.
IGNORED = {"json5", "aiofiles"}

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
    reqs=[]
    for raw in md.requires("gpt-researcher") or []:
        req=Requirement(raw)
        if normalized(req.name) in IGNORED:
            continue
        if req.marker and not req.marker.evaluate({"extra":""}):
            continue
        reqs.append(str(req))
    with tempfile.TemporaryDirectory(prefix="atlas-gptr-deps-") as td:
        p=Path(td)/"requirements.txt"
        p.write_text("\n".join(reqs)+"\n",encoding="utf-8")
        pip("install","-r",str(p))
    pip("install","json5>=0.12.0","aiofiles~=24.1.0")
    # unstructured-client's newer aiofiles requirement is not on Atlas' runtime
    # path. Validate the imports and exact engine entry points we actually ship.
    probe = (
        "import importlib.metadata as m; "
        "import fastapi,httpx,crewai,gpt_researcher,pywintypes,ddgs; "
        "from crewai import LLM,Agent,Task,Crew,Process; "
        "from ddgs import DDGS; "
        "from gpt_researcher import GPTResearcher; "
        "from gpt_researcher.retrievers.duckduckgo.duckduckgo import Duckduckgo; "
        "assert callable(getattr(Duckduckgo('atlas dependency probe'),'search',None)); "
        "print({k:m.version(k) for k in "
        "['fastapi','httpx','crewai','gpt-researcher','ddgs','json5','aiofiles','pywin32']})"
    )
    subprocess.check_call([sys.executable,"-c",probe])
    return 0

if __name__=="__main__":
    raise SystemExit(main())
