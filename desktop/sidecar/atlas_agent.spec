# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import copy_metadata, collect_data_files, collect_submodules
from pathlib import Path

# ATLANEX packages the real agent runtime without an embedded HTTP server.
# Electron communicates with this child process over stdin/stdout JSON-RPC.
hiddenimports = [
    "crewai",
    "crewai.llm",
    "crewai.llms.base_llm",
    "litellm",
    "gpt_researcher",
    "langchain_classic",
    "langchain_classic.retrievers",
    "langchain_classic.retrievers.contextual_compression",
    "langchain_classic.retrievers.document_compressors",
    "httpx",
    "pydantic",
    "lxml",
    "lxml.etree",
    "langchain_google_genai",
    "google.ai.generativelanguage",
    "google.api_core",
]

datas = [("gptr_config.json", ".")]
datas += collect_data_files("crewai")
datas += collect_data_files("gpt_researcher", include_py_files=True)
hiddenimports += collect_submodules("ddgs")
datas += collect_data_files("ddgs")
hiddenimports += collect_submodules("tiktoken_ext")
try:
    import crewai as _crewai
    _prompt = Path(_crewai.__file__).resolve().parent / "translations" / "en.json"
    if _prompt.exists():
        datas.append((str(_prompt), "crewai/translations"))
except Exception:
    pass
hiddenimports += collect_submodules("gpt_researcher.retrievers", filter=lambda n: n != "gpt_researcher.retrievers.mcp")
hiddenimports += collect_submodules("langchain_classic.retrievers.document_compressors")
hiddenimports += collect_submodules("langchain_classic.retrievers", filter=lambda n: n in {
    "langchain_classic.retrievers.contextual_compression",
})
for package in ("crewai","gpt-researcher","litellm","langchain-classic","langchain-core","langchain-community","ddgs","langchain-google-genai"):
    try:
        datas += copy_metadata(package)
    except Exception:
        pass

excludes = [
    "fastapi","uvicorn","starlette",
    "tkinter","matplotlib","IPython","notebook","jupyter","jupyterlab",
    "torch","torchvision","torchaudio","tensorflow","tensorflow_intel",
    "jax","jaxlib","numba","llvmlite","numpy.testing",
    "pandas","pyarrow","scipy","sklearn","spacy","thinc",
    "nltk","langchain","sqlalchemy","pdfminer",
    "pdfplumber","pypdfium2","pypdfium2_raw",
    "cv2","PIL.ImageQt",
    "unstructured","unstructured_client",
    "lancedb","onnxruntime",
    "boto3","botocore","sagemaker",
    "pymongo","MySQLdb","pysqlite2","weasyprint","fitz","pymupdf",
    "magic","gpt_researcher.retrievers.mcp","langchain_mcp_adapters",
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
    bootloader_ignore_signals=False, strip=False, upx=False, console=True,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="atlas-agent-engine")
