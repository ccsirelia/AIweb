@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0AIWeb-restart.ps1" %*
exit /b %ERRORLEVEL%
