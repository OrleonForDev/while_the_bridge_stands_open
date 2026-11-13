@echo off
setlocal
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. See START-HERE.txt.
  pause
  exit /b 1
)
node.exe "%~dp0serve.mjs"
if errorlevel 1 (
  pause
  exit /b 1
)
