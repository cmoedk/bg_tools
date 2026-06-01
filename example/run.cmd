@echo off
REM Launch the bg_tools menu against this project folder.
cd /d "%~dp0"
call pnpm run tools
pause
