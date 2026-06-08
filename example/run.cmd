@echo off
setlocal EnableExtensions
REM Launch the bg_tools menu against this project folder.
cd /d "%~dp0"

REM If the portable toolchain (from install.cmd) is present, put it on PATH.
REM Otherwise fall back to a system-wide Node/pnpm.
if exist "%~dp0.runtime\node\node.exe" set "PATH=%~dp0.runtime\node;%~dp0.runtime\git\cmd;%~dp0.runtime;%PATH%"

REM --- Check for a newer bg_tools and offer to update ---
set "LOCALVER="
set "REMOTEVER="
for /f "delims=" %%v in ('node -p "require('./node_modules/bg_tools/package.json').version" 2^>nul') do set "LOCALVER=%%v"
for /f "delims=" %%v in ('powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { (Invoke-RestMethod -UseBasicParsing 'https://raw.githubusercontent.com/cmoedk/bg_tools/main/package.json').version } catch { '' }" 2^>nul') do set "REMOTEVER=%%v"
if defined LOCALVER if defined REMOTEVER if not "%REMOTEVER%"=="%LOCALVER%" (
    echo.
    echo A different bg_tools version is available online ^(installed %LOCALVER%, latest %REMOTEVER%^).
    choice /C YN /N /M "Update bg_tools now? [Y/N] "
    if not errorlevel 2 call pnpm update bg_tools
    echo.
)

call pnpm run tools
pause
endlocal
