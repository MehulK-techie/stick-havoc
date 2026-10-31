@echo off
rem Stick Havoc: start the host on Windows. Double-click this file.
rem Checks for Node.js, installs what is missing the first time, opens the
rem browser and starts the server (close this window to stop it).
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000

where node >nul 2>nul
if errorlevel 1 (
  echo Stick Havoc needs Node.js 18 or newer: https://nodejs.org
  echo Install the LTS version, then double-click run.bat again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing express, ws and qrcode-terminal...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo The install failed. Is this computer online for this first run?
    pause
    exit /b 1
  )
)

rem the browser, a moment after the server starts
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:%PORT%"
echo Starting Stick Havoc. Close this window to stop it.
node server.js
pause
