# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files, copy_metadata, collect_submodules

# Do NOT recursively collect CrewAI/GPT Researcher/LangChain.
# PyInstaller's normal import graph starts from server.py; explicit entries below
# cover the runtime imports used by Atlas without dragging every optional plugin.
hiddenimports = [
    "crewai",
    "crewai.llm",
    "gpt_researcher",
    "gpt_researcher.retrievers.duckduckgo.duckduckgo",
    "ddgs",
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
# ddgs is small, but parts of the retriever stack are discovered at runtime.
# Collect only ddgs recursively; keep CrewAI/GPT Researcher/LangChain selective.
try:
    hiddenimports += collect_submodules("ddgs")
except Exception:
    pass

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
    # CrewAI resolves translation JSON relative to package __file__. The custom
    # hook keeps CrewAI source modules outside PYZ so that path is a real folder.
    hookspath=["hooks"],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter", "matplotlib", "IPython", "notebook", "jupyter",
        "torch", "tensorflow", "tensorflow_intel",
        # python-magic probes native libmagic during import on Windows. It is
        # pulled by optional unstructured loaders, but Atlas' shipped GPTR path
        # uses SCRAPER=bs and its packaged deep self-test uses TextLoader.
        # Excluding it also avoids PyInstaller's isolated import crash.
        "magic",
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
