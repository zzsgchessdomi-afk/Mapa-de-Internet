from __future__ import annotations
import importlib.metadata as md
import subprocess, sys, tempfile
from pathlib import Path

BASE = [
    "fastapi>=0.115,<1",
    "uvicorn[standard]>=0.30,<1",
    "httpx>=0.28.1,<1",
    "crewai==1.15.22",
    "ddgs==9.16.0",
]
GPTR = "gpt-researcher==0.15.1"
IGNORED_GPTR = {"json5","aiofiles","unstructured","unstructured-client","python-magic"}
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
    with tempfile.TemporaryDirectory(prefix="atlas-gptr-deps-") as td:
        p=Path(td)/"requirements.txt"
        p.write_text("\n".join(reqs)+"\n",encoding="utf-8")
        pip("install","-r",str(p))
    pip("install",*RUNTIME_OVERRIDES)
    # python-magic 0.4.x can crash PyInstaller's isolated dependency scanner on
    # Windows when importing `magic`; file-type detection is not required by
    # the packaged ATLANEX agent paths, so keep it out of the frozen runtime.
    pip("uninstall","-y","python-magic")
    installed={normalized(d.metadata["Name"]) for d in md.distributions() if d.metadata.get("Name")}
    required=("fastapi","uvicorn","httpx","crewai","gpt-researcher","litellm","pywin32","ddgs")
    missing=[p for p in required if normalized(p) not in installed]
    if missing:
        raise RuntimeError("Required ATLANEX runtime packages are missing: "+repr(missing))
    leaked=[p for p in ("unstructured","unstructured-client","spacy","numba","llvmlite","python-magic") if normalized(p) in installed]
    if leaked:
        raise RuntimeError("Heavy optional document stack leaked into Atlas runtime: "+repr(leaked))
    probe=(
        "import importlib.metadata as m; "
        "import fastapi,httpx,crewai,gpt_researcher,litellm,pywintypes,ddgs; "
        "from ddgs import DDGS; "
        "from crewai import LLM,Agent,Task,Crew,Process; "
        "from gpt_researcher import GPTResearcher; "
        "assert DDGS is not None; "
        "print({k:m.version(k) for k in "
        "['fastapi','httpx','crewai','gpt-researcher','litellm','json5','aiofiles','pywin32','ddgs']})"
    )
    subprocess.check_call([sys.executable,"-c",probe])
    return 0

if __name__=="__main__":
    raise SystemExit(main())
