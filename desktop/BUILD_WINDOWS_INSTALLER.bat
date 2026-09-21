@echo off
setlocal
cd /d "%~dp0"
title Internet Atlas - Release Build

where node >nul 2>nul || (echo [ERROR] Node.js 22+ requerido & pause & exit /b 1)
where py >nul 2>nul || (echo [ERROR] Python 3.12 requerido SOLO para compilar, no para el comprador & pause & exit /b 1)

echo [1/8] Preparando entorno Python aislado...
if exist .build-venv rmdir /s /q .build-venv
py -3.12 -m venv .build-venv || goto :fail
.build-venv\Scripts\python.exe -m pip install --upgrade pip wheel pyinstaller || goto :fail
.build-venv\Scripts\python.exe -m pip install -r sidecar\requirements.txt || goto :fail

echo [2/8] Compilando Agent Engine...
pushd sidecar
..\.build-venv\Scripts\python.exe -m PyInstaller --noconfirm --clean atlas_agent.spec || (popd & goto :fail)
popd
if exist bundled-agent-engine rmdir /s /q bundled-agent-engine
xcopy /e /i /y sidecar\dist\atlas-agent-engine bundled-agent-engine >nul || goto :fail

echo [3/8] Inventario de licencias...
.build-venv\Scripts\python.exe scripts\collect_python_licenses.py || goto :fail
copy /y ..\THIRD_PARTY_NOTICES.md bundled-agent-engine\THIRD_PARTY_NOTICES.md >nul || goto :fail

echo [4/8] Self-test del motor...
bundled-agent-engine\atlas-agent-engine.exe --self-test-deep || goto :fail

echo [5/8] Dependencias Electron...
call npm install --no-audit --no-fund || goto :fail
call npm run check || goto :fail

echo [6/8] Construyendo NSIS + Portable...
call npm run dist:win || goto :fail

echo [7/8] Smoke test del EXE portable...
for %%F in (dist\Internet-Atlas-Portable-*.exe) do (
  "%%F" --acceptance-test
  if errorlevel 1 goto :fail
  goto :portable_ok
)
echo [ERROR] No se encontro el EXE portable.
goto :fail
:portable_ok

echo [8/8] Generando SHA256SUMS...
powershell -NoProfile -Command "Get-ChildItem 'dist\*.exe' | ForEach-Object { ('{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.Name) } | Set-Content 'dist\SHA256SUMS.txt'" || goto :fail

echo.
echo LISTO: %CD%\dist
echo El build paso Agent Engine profundo, Internet real, monitor, renderer/preload del EXE portable y hashes de release.
pause
exit /b 0

:fail
echo.
echo [ERROR] Build detenido. No publiques los artefactos.
pause
exit /b 1
