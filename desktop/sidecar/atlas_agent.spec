# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_data_files, copy_metadata

# Keep Atlas' real runtime packages, but explicitly exclude heavyweight optional
# ecosystems that are not used by server.py. This prevents PyInstaller from
# recursively scanning thousands of optional scientific/ML/database modules.
hiddenimports = [
    "crewai",
    "crewai.llm",
    "gpt_researcher",
    "litellm",
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
