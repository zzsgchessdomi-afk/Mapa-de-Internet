@echo off
setlocal
cd /d "%~dp0"
title Internet Atlas
echo.
if not exist sidecar\.venv\Scripts\python.exe (
  echo [NO INSTALADO] El entorno de agentes no existe todavia.
  echo Abre Atlas Desktop y pulsa Agentes - Instalar motor.
  pause
  exit /b 1
)
set ATLAS_LLM_BASE_URL=http://127.0.0.1:8788/v1
sidecar\.venv\Scripts\python.exe sidecar\smoke_test.py
echo.
pause
