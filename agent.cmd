@echo off
setlocal
chcp 65001 >nul
set SCRIPT_DIR=%~dp0
cscript.exe //nologo "%SCRIPT_DIR%agent.js" %*
endlocal
