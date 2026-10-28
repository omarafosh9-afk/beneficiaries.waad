@echo off
rem Double-click: upload code changes to the server (data and photos are not touched).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\server\update.ps1"
pause
