@echo off
REM Launch the bg_tools menu against this project folder.
cd /d "%~dp0"

REM If the portable toolchain (from install.cmd) is present, put it on PATH.
REM Otherwise fall back to a system-wide Node/pnpm.
if exist "%~dp0.runtime\node\node.exe" set "PATH=%~dp0.runtime\node;%~dp0.runtime\git\cmd;%~dp0.runtime;%PATH%"

call pnpm run tools
pause
