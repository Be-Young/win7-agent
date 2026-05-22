@echo off
setlocal
cd /d "%~dp0\.."

where go >nul 2>nul
if errorlevel 1 (
  echo Go 1.20 is required to build the EXE edition.
  exit /b 1
)

go version
go test ./...
if errorlevel 1 exit /b 1

if not exist dist mkdir dist
if exist dist\agent-win7-x64 rmdir /s /q dist\agent-win7-x64
mkdir dist\agent-win7-x64
mkdir dist\agent-win7-x64\config
mkdir dist\agent-win7-x64\skills
mkdir dist\agent-win7-x64\docs

set GOOS=windows
set GOARCH=amd64
set CGO_ENABLED=0
go build -trimpath -ldflags "-s -w" -o dist\agent-win7-x64\agent.exe .\cmd\agent
if errorlevel 1 exit /b 1

xcopy config dist\agent-win7-x64\config /E /I /Y >nul
xcopy skills dist\agent-win7-x64\skills /E /I /Y >nul
copy docs\quickstart.md dist\agent-win7-x64\docs\quickstart.md >nul
copy docs\build.md dist\agent-win7-x64\docs\build.md >nul
copy docs\user-manual-zh.md dist\agent-win7-x64\docs\user-manual-zh.md >nul

certutil -hashfile dist\agent-win7-x64\agent.exe SHA256 > dist\agent-win7-x64\checksums.txt
echo Built dist\agent-win7-x64
endlocal
