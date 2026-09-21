# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules, collect_data_files, copy_metadata

# Keep the bundle focused on the two engines Atlas actually imports.
# collect_all(langchain_community/...) pulled thousands of optional integrations
# into the Windows build and made PyInstaller spend >90 minutes analysing them.
engine_packages = ["crewai", "gpt_researcher"]
hiddenimports = []
datas = [("gptr_config.json", ".")]

for package in engine_packages:
    try:
        hiddenimports += collect_submodules(package)
    except Exception:
        pass
    try:
        datas += collect_data_files(package, include_py_files=False)
    except Exception:
        pass
    try:
        datas += copy_metadata(package)
    except Exception:
        pass

# These are imported directly by server.py or by the engine entry paths used at runtime.
hiddenimports += [
    "fastapi",
    "uvicorn",
    "httpx",
    "pydantic",
    "litellm",
    "langchain",
    "langchain_core",
    "langchain_community",
    "langchain_openai",
]

a = Analysis(
    ["server.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=sorted(set(hiddenimports)),
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
