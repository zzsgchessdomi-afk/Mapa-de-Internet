# -*- mode: python ; coding: utf-8 -*-
# ATLANEX Windows sidecar. The agent frameworks expose many optional plugins;
# exclude stacks the sidecar does not exercise so PyInstaller does not walk
# unrelated native DLL graphs.
from PyInstaller.utils.hooks import copy_metadata

hiddenimports = [
    "crewai",
    "crewai.llm",
    "litellm",
    "gpt_researcher",
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
for package in ("crewai", "gpt-researcher", "litellm"):
    try:
        datas += copy_metadata(package)
    except Exception:
        pass

excludes = [
    "tkinter", "matplotlib", "IPython", "notebook", "jupyter", "jupyterlab",
    "torch", "torchvision", "torchaudio", "tensorflow", "tensorflow_intel",
    "jax", "jaxlib", "numba", "llvmlite", "numpy.testing",
    "pandas", "pyarrow", "scipy", "sklearn", "spacy", "thinc",
    "cv2", "PIL.ImageQt",
    "unstructured", "unstructured_client",
    "chromadb", "lancedb", "onnxruntime",
    "boto3", "botocore", "sagemaker",
    "pymongo", "MySQLdb", "pysqlite2",
]

a = Analysis(
    ["server.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
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
