# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files, copy_metadata

# Atlanex packages the real agent runtime but does not embed a web server.
# The Electron host talks to this process over stdin/stdout JSON-RPC.
hiddenimports = [
    "crewai",
    "crewai.llm",
    "crewai.llms.base_llm",
    "gpt_researcher",
    "litellm",
    "httpx",
    "pydantic",
    "langchain_google_genai",
    "google.ai.generativelanguage",
    "google.api_core",
]
datas = [("gptr_config.json", ".")]
for package in ["crewai", "gpt_researcher", "langchain_google_genai"]:
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
        "fastapi", "uvicorn", "starlette",
        "tkinter", "matplotlib", "IPython", "notebook", "jupyter", "jupyterlab",
        "torch", "torchvision", "torchaudio", "tensorflow", "tensorflow_intel",
        "jax", "jaxlib", "numba", "llvmlite", "numpy.testing",
        "pandas", "pyarrow", "scipy", "sklearn", "spacy", "thinc",
        "cv2", "PIL.ImageQt",
        "boto3", "botocore", "sagemaker",
        "pymongo", "MySQLdb", "pysqlite2",
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
