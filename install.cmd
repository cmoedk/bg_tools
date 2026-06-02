@echo off
setlocal EnableExtensions
title bg_tools installer
color 0B

REM ------------------------------------------------------------
REM  Portable installer - no winget, no admin, nothing installed
REM  system-wide. Node, Git (MinGit) and pnpm are downloaded as
REM  portable builds into  <project>\.runtime\  and the project's
REM  run.cmd puts them on PATH when you launch the tools.
REM ------------------------------------------------------------

REM  Pinned tool versions (bump these to upgrade).
set "NODE_VER=20.18.1"
set "GIT_VER=2.47.1"
set "GIT_TAG=v2.47.1.windows.1"
set "PNPM_VER=9.15.0"

set "NODE_URL=https://nodejs.org/dist/v%NODE_VER%/node-v%NODE_VER%-win-x64.zip"
set "GIT_URL=https://github.com/git-for-windows/git/releases/download/%GIT_TAG%/MinGit-%GIT_VER%-64-bit.zip"
set "PNPM_URL=https://github.com/pnpm/pnpm/releases/download/v%PNPM_VER%/pnpm-win-x64.exe"
set "REPO_ZIP=https://codeload.github.com/cmoedk/bg_tools/zip/refs/heads/main"

echo(
echo  ============================================================
echo    bg_tools - Board Game Design Toolkit
echo    Portable installer
echo  ============================================================
echo(
echo  This will:
echo     1. Let you choose a folder for your games
echo     2. Download portable Node.js, Git and pnpm into it
echo        (nothing is installed system-wide)
echo     3. Create a new project from the bg_tools example
echo(
echo  Tip: a few hundred MB will be downloaded the first time.
echo(
pause
echo(

REM ------------------------------------------------------------
REM  1. Choose location + project name
REM ------------------------------------------------------------
echo  A folder picker will open - choose WHERE your project folder
echo  should be created (e.g. your Documents folder).
echo(
pause
call :PICK_FOLDER
if not defined TARGET goto NO_FOLDER

:ASK_NAME
set "PROJNAME="
set /p "PROJNAME=Enter a name for the new project folder [my-board-games]: "
if not defined PROJNAME set "PROJNAME=my-board-games"
set "PROJECT=%TARGET%\%PROJNAME%"
if exist "%PROJECT%\" (
  echo       "%PROJECT%" already exists - please pick another name.
  goto ASK_NAME
)

set "RUNTIME=%PROJECT%\.runtime"
set "WORK=%TEMP%\bg_setup_%RANDOM%%RANDOM%"
mkdir "%PROJECT%"      2>nul
mkdir "%RUNTIME%"      2>nul
mkdir "%WORK%"         2>nul

REM ------------------------------------------------------------
REM  2. Download the portable toolchain
REM ------------------------------------------------------------
echo(
echo [1/4] Downloading portable Node.js %NODE_VER% ...
powershell -NoProfile -Command "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%WORK%\node.zip'; Expand-Archive -Path '%WORK%\node.zip' -DestinationPath '%WORK%\nodetmp' -Force; $d=Get-ChildItem -Directory '%WORK%\nodetmp' ^| Select-Object -First 1; Move-Item -Path $d.FullName -Destination '%RUNTIME%\node'"
if errorlevel 1 goto DL_FAIL

echo [2/4] Downloading portable Git %GIT_VER% ...
powershell -NoProfile -Command "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%GIT_URL%' -OutFile '%WORK%\git.zip'; Expand-Archive -Path '%WORK%\git.zip' -DestinationPath '%RUNTIME%\git' -Force"
if errorlevel 1 goto DL_FAIL

echo [3/4] Downloading pnpm %PNPM_VER% ...
powershell -NoProfile -Command "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%PNPM_URL%' -OutFile '%RUNTIME%\pnpm.exe'"
if errorlevel 1 goto DL_FAIL

REM  Put the portable tools on PATH for the rest of this session.
set "PATH=%RUNTIME%\node;%RUNTIME%\git\cmd;%RUNTIME%;%PATH%"

REM ------------------------------------------------------------
REM  3. Create the project from the example
REM ------------------------------------------------------------
echo [4/4] Creating your project ...
powershell -NoProfile -Command "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%REPO_ZIP%' -OutFile '%WORK%\repo.zip'; Expand-Archive -Path '%WORK%\repo.zip' -DestinationPath '%WORK%\repo' -Force"
if errorlevel 1 goto DL_FAIL

set "EXAMPLE=%WORK%\repo\bg_tools-main\example"
if not exist "%EXAMPLE%\package.json" goto REPO_FAIL
xcopy "%EXAMPLE%\*" "%PROJECT%\" /E /I /Q /Y >nul

echo       Initializing a git repository...
pushd "%PROJECT%"
git init -q

echo       Installing dependencies (this downloads the browser used
echo       to render cards - it can take a few minutes)...
call "%RUNTIME%\pnpm.exe" install
popd

rmdir /s /q "%WORK%" 2>nul

echo(
echo  ============================================================
echo    All done!
echo    Your project is here:
echo      %PROJECT%
echo(
echo    To open the tools later, double-click  run.cmd  in that
echo    folder. The portable tools live in  .runtime\  there.
echo  ============================================================
echo(

choice /C YN /N /M "Launch the bg_tools menu now? [Y/N] "
if errorlevel 2 goto END
pushd "%PROJECT%"
call pnpm run tools
popd
goto END


REM ============================================================
REM  Subroutine: native folder picker
REM ============================================================
:PICK_FOLDER
set "TARGET="
for /f "usebackq delims=" %%f in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose where to create your board-games project'; $d.ShowNewFolderButton = $true; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine($d.SelectedPath) }"`) do set "TARGET=%%f"
goto :eof


REM ============================================================
REM  Error exits
REM ============================================================
:DL_FAIL
echo(
echo  ERROR: a download or extraction failed.
echo  Check your internet connection and try again. If a tool
echo  version is no longer available, edit the versions near the
echo  top of this script.
echo(
if exist "%WORK%" rmdir /s /q "%WORK%" 2>nul
pause
goto END

:REPO_FAIL
echo(
echo  ERROR: could not find the example project inside the
echo  downloaded repository archive.
echo(
if exist "%WORK%" rmdir /s /q "%WORK%" 2>nul
pause
goto END

:NO_FOLDER
echo(
echo  No folder was selected - nothing was created. Run the
echo  installer again when you are ready.
echo(
pause
goto END

:END
endlocal
