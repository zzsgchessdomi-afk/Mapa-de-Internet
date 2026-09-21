from __future__ import annotations
import importlib.metadata as md
import subprocess, sys, tempfile
from pathlib import Path

BASE = [
    "fastapi>=0.115,<1",
    "uvicorn[standard]>=0.30,<1",
    "httpx>=0.28.1,<1",
    "crewai==1.15.22",
]
GPTR = "gpt-researcher==0.15.1"
# CrewAI 1.15.22 pins json5~=0.10.0 while GPT Researcher 0.15.1 declares
# json5>=0.12.0. Atlas keeps CrewAI's supported json5 and validates the exact
# GPT Researcher code path with --self-test-deep before any release is accepted.
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
    pip("install","json5~=0.10.0","aiofiles~=24.1.0")
    # Validate in a fresh interpreter so newly installed .pth files (notably
    # pywin32/pywintypes on Windows) are processed by Python startup.
    probe = (
        "import importlib.metadata as m; "
        "import fastapi,httpx,crewai,gpt_researcher,pywintypes; "
        "print({k:m.version(k) for k in "
        "['fastapi','httpx','crewai','gpt-researcher','json5','aiofiles','pywin32']})"
    )
    subprocess.check_call([sys.executable,"-c",probe])
    return 0

if __name__=="__main__":
    raise SystemExit(main())
