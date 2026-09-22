# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files, copy_metadata

# Do NOT recursively collect CrewAI/GPT Researcher/LangChain.
# PyInstaller's normal import graph starts from server.py; explicit entries below
# cover the runtime imports used by Atlas without dragging every optional plugin.
hiddenimports = [
    "crewai",
    "crewai.llm",
    "gpt_researcher",
    "litellm",
    "langchain",
    "langchain_core",
    "langchain_community",
    "langchain_openai",
    "fastapi",
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "httpx",
    "pydantic",
]
datas = [("gptr_config.json", ".")]
for package in ["crewai", "gpt_researcher"]:
    try:
        datas += collect_data_files(package, include_py_files=False)
    except Exception:
        pass
    try:
        datas += copy_metadata(package)
    except Exception:
        pass

a = Analysis(
    ["server.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter", "matplotlib", "IPython", "notebook", "jupyter",
        "torch", "tensorflow", "tensorflow_intel",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [], exclude_binaries=True,
    name="atlas-agent-engine", debug=False,
    bootloader_ignore_signals=False, strip=False, upx=False, console=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="atlas-agent-engine")
