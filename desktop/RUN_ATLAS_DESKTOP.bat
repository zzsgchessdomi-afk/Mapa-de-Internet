@echo off
setlocal
cd /d "%~dp0"
title Internet Atlas
where node >nul 2>nul || (echo Node.js 20+ requerido & pause & exit /b 1)
if not exist node_modules (
  echo Instalando Electron...
  call npm install || (pause & exit /b 1)
)
call npm start
