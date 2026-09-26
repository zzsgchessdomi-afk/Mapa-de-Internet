from __future__ import annotations
import base64, hashlib, os, pathlib, shutil, subprocess, sys, zipfile

REPO = pathlib.Path(__file__).resolve().parents[1]
PAYLOAD = REPO / "cybernexus-build" / "CyberNexus_EXE_SOURCE.b64"
WORK = pathlib.Path(os.environ.get("RUNNER_TEMP", str(REPO / ".cybernexus-build"))) / "cybernexus"
ZIP = WORK / "CyberNexus_EXE_SOURCE.zip"
SRCROOT = WORK / "src"
OUTDIR = REPO / "desktop" / "dist"

def run(*args, cwd=None):
    print("+", *map(str,args), flush=True)
    subprocess.check_call([str(x) for x in args], cwd=str(cwd) if cwd else None)

def main():
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)
    raw = base64.b64decode(PAYLOAD.read_text(encoding="ascii"))
    ZIP.write_bytes(raw)
    print("source_zip_sha256=", hashlib.sha256(raw).hexdigest(), flush=True)

    with zipfile.ZipFile(ZIP) as z:
        z.extractall(SRCROOT)

    candidates = [p for p in SRCROOT.rglob("CyberNexus.pyw")]
    if len(candidates) != 1:
        raise SystemExit(f"expected exactly one CyberNexus.pyw, got {len(candidates)}")
    app_root = candidates[0].parent

    # Source integrity gates before packaging.
    run(sys.executable, "-m", "compileall", "-q", str(app_root))
    code = (
        "import json,pathlib; "
        f"p=pathlib.Path(r'{app_root}')/'data'; "
        "fs=list(p.glob('phase*_curriculum.json')); "
        "assert len(fs)==20, len(fs); "
        "total=sum(len(json.load(open(f,encoding='utf-8'))['modules']) for f in fs); "
        "print('PHASES',len(fs),'MODULES',total); assert total==843"
    )
    run(sys.executable, "-c", code)
    run(sys.executable, "-c", "import tkinter; print('TKINTER_IMPORT_OK')")

    run(sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir", "pyinstaller==6.16.0")

    run(
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--onefile", "--windowed",
        "--name", "CyberNexus",
        "--add-data", f"{app_root/'data'}{os.pathsep}data",
        "--add-data", f"{app_root/'ranges'}{os.pathsep}ranges",
        "--add-data", f"{app_root/'vm_blueprints'}{os.pathsep}vm_blueprints",
        str(app_root / "CyberNexus.pyw"),
        cwd=WORK,
    )

    exe = WORK / "dist" / "CyberNexus.exe"
    if not exe.exists():
        raise SystemExit("PyInstaller did not produce CyberNexus.exe")
    data = exe.read_bytes()
    if data[:2] != b"MZ":
        raise SystemExit("output is not a PE/MZ executable")

    OUTDIR.mkdir(parents=True, exist_ok=True)
    final = OUTDIR / "CyberNexus.exe"
    shutil.copy2(exe, final)
    digest = hashlib.sha256(final.read_bytes()).hexdigest()
    (OUTDIR / "CyberNexus-SHA256.txt").write_text(f"{digest}  CyberNexus.exe\n", encoding="utf-8")
    print("CYBERNEXUS_EXE=", final, flush=True)
    print("CYBERNEXUS_SIZE=", final.stat().st_size, flush=True)
    print("CYBERNEXUS_SHA256=", digest, flush=True)

if __name__ == "__main__":
    main()
