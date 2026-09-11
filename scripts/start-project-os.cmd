@echo off
setlocal
title Project OS
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo [Project OS] Node.js is not installed or is not in PATH.
  echo Install Node.js 22 LTS from https://nodejs.org and reopen this shortcut.
  pause
  exit /b 1
)
node "%~dp0launcher.mjs" %*
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
  echo.
  echo Project OS did not start. Follow the instructions above.
  pause
)
exit /b %RESULT%
