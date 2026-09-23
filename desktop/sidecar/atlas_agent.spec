# -*- mode: python ; coding: utf-8 -*-
# ATLANEX Windows sidecar. The agent frameworks expose many optional plugins;
# exclude stacks the sidecar does not exercise so PyInstaller does not walk
# unrelated native DLL graphs.
from PyInstaller.utils.hooks import copy_metadata, collect_data_files, collect_submodules
from pathlib import Path

hiddenimports = [
    "crewai",
    "crewai.llm",
    "litellm",
    "gpt_researcher",
    "langchain_classic",
    "langchain_classic.retrievers",
    "langchain_classic.retrievers.contextual_compression",
    "langchain_classic.retrievers.document_compressors",
    "fastapi",
    "uvicorn",
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "httpx",
    "pydantic",
    "lxml",
    "lxml.etree",
]

datas = [("gptr_config.json", ".")]
# CrewAI loads its default prompts from crewai/translations/en.json at import time.
# Include that package data explicitly so the frozen runtime works after it is moved
# into Electron extraResources, not only beside the build environment.
datas += collect_data_files("crewai")
# Force the exact default CrewAI prompt asset into the frozen path expected by
# crewai.utilities.i18n.I18N, even if PyInstaller package-data discovery changes.
try:
    import crewai as _crewai
    _prompt = Path(_crewai.__file__).resolve().parent / "translations" / "en.json"
    if _prompt.exists():
        datas.append((str(_prompt), "crewai/translations"))
except Exception:
    pass
# GPT Researcher imports these through langchain_classic at runtime; PyInstaller
# cannot always see the dynamic package imports from __init__.py.
hiddenimports += collect_submodules("langchain_classic.retrievers.document_compressors")
hiddenimports += collect_submodules("langchain_classic.retrievers", filter=lambda n: n in {
    "langchain_classic.retrievers.contextual_compression",
})
for package in ("crewai", "gpt-researcher", "litellm", "fastapi", "langchain-classic", "langchain-core", "langchain-community"):
    try:
        datas += copy_metadata(package)
    except Exception:
        pass

excludes = [
    "tkinter", "matplotlib", "IPython", "notebook", "jupyter", "jupyterlab",
    "torch", "torchvision", "torchaudio", "tensorflow", "tensorflow_intel",
    "jax", "jaxlib", "numba", "llvmlite", "numpy.testing",
    "pandas", "pyarrow", "scipy", "sklearn", "spacy", "thinc",
    "nltk", "langchain", "sqlalchemy", "pdfminer",
    "pdfplumber", "pypdfium2", "pypdfium2_raw",
    "cv2", "PIL.ImageQt",
    "unstructured", "unstructured_client",
    # CrewAI imports its ChromaDB storage adapter at package import time even when
    # ATLANEX does not enable RAG/memory, so ChromaDB must remain bundle-visible.
    "lancedb", "onnxruntime",
    "boto3", "botocore", "sagemaker",
    "pymongo", "MySQLdb", "pysqlite2", "weasyprint", "fitz", "pymupdf",
    # python-magic crashes PyInstaller isolated binary-dependency scanning on Windows;
    # Atlas/GPT Researcher does not need libmagic for its supported packaged paths.
    "magic",
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
