@echo off
setlocal EnableExtensions
title bg_tools installer
color 0B

set "REPO=https://github.com/cmoedk/bg_tools"

echo(
echo  ============================================================
echo    bg_tools - Board Game Design Toolkit
echo    Beginner installer
echo  ============================================================
echo(
echo  This will:
echo     1. Install Git, Node.js and pnpm  (only if missing)
echo     2. Let you choose a folder for your games
echo     3. Create a new project from the bg_tools example
echo(
echo  You may see Windows "User Account Control" prompts during
echo  the software installs - please click Yes.
echo(
pause
echo(

REM ------------------------------------------------------------
REM  0. winget (App Installer) is required to install software
REM ------------------------------------------------------------
where winget >nul 2>&1
if errorlevel 1 goto NO_WINGET

REM ------------------------------------------------------------
REM  1. Git
REM ------------------------------------------------------------
echo [1/4] Git
where git >nul 2>&1 && echo       already installed. || (
  echo       installing...
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
)

REM ------------------------------------------------------------
REM  2. Node.js (LTS)
REM ------------------------------------------------------------
echo [2/4] Node.js
where node >nul 2>&1 && echo       already installed. || (
  echo       installing...
  winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
)

REM  Pick up Git/Node without needing a new terminal.
call :REFRESH_PATH

REM ------------------------------------------------------------
REM  3. pnpm
REM ------------------------------------------------------------
echo [3/4] pnpm
where pnpm >nul 2>&1 && echo       already installed. || (
  echo       setting up via corepack...
  call corepack enable >nul 2>&1
  call corepack prepare pnpm@latest --activate >nul 2>&1
  call :REFRESH_PATH
)
where pnpm >nul 2>&1 || (
  echo       corepack unavailable - installing pnpm via npm...
  call npm install -g pnpm
  call :REFRESH_PATH
)

REM  Final sanity check that the toolchain is now usable.
where git  >nul 2>&1 || goto TOOL_MISSING
where node >nul 2>&1 || goto TOOL_MISSING
where pnpm >nul 2>&1 || goto TOOL_MISSING

REM ------------------------------------------------------------
REM  4. Create the project
REM ------------------------------------------------------------
echo [4/4] Your project
echo(
echo       A folder picker will open - choose WHERE your project
echo       folder should be created (e.g. your Documents folder).
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

echo(
echo       Downloading the example project...
set "TMPCLONE=%TEMP%\bg_tools_src_%RANDOM%%RANDOM%"
git clone --depth 1 "%REPO%" "%TMPCLONE%"
if errorlevel 1 goto CLONE_FAIL

mkdir "%PROJECT%"
xcopy "%TMPCLONE%\example\*" "%PROJECT%\" /E /I /Q /Y >nul
rmdir /s /q "%TMPCLONE%"

echo       Initializing a git repository...
pushd "%PROJECT%"
git init -q

echo       Installing dependencies (this can take a few minutes -
echo       it downloads the browser used to render cards)...
call pnpm install
popd

echo(
echo  ============================================================
echo    All done!
echo    Your project is here:
echo      %PROJECT%
echo(
echo    To open the tools later, double-click  run.cmd  in that
echo    folder, or run  "pnpm run tools"  from it.
echo  ============================================================
echo(

choice /C YN /N /M "Launch the bg_tools menu now? [Y/N] "
if errorlevel 2 goto END
pushd "%PROJECT%"
call pnpm run tools
popd
goto END


REM ============================================================
REM  Subroutines
REM ============================================================

:REFRESH_PATH
REM  Rebuild PATH from the machine + user registry values, fully
REM  expanded, so tools installed earlier in this run are found.
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "[Environment]::ExpandEnvironmentVariables([Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User'))"`) do set "PATH=%%p"
goto :eof

:PICK_FOLDER
set "TARGET="
for /f "usebackq delims=" %%f in (`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose where to create your board-games project'; $d.ShowNewFolderButton = $true; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine($d.SelectedPath) }"`) do set "TARGET=%%f"
goto :eof


REM ============================================================
REM  Error exits
REM ============================================================

:NO_WINGET
echo(
echo  ERROR: "winget" (App Installer) was not found on this PC.
echo  It is needed to install Git, Node.js and pnpm.
echo(
echo  Please install "App Installer" from the Microsoft Store,
echo  then run this script again. Opening the Store now...
start "" "ms-windows-store://pdp/?productid=9NBLGGH4NNS1"
echo(
pause
goto END

:TOOL_MISSING
echo(
echo  The required tools were installed but are not yet visible
echo  in this window. Please CLOSE this window, then download and
echo  run install.cmd again - it will skip what is already done.
echo(
pause
goto END

:NO_FOLDER
echo(
echo  No folder was selected - nothing was created. Run the
echo  installer again when you are ready.
echo(
pause
goto END

:CLONE_FAIL
echo(
echo  ERROR: could not download the example project from:
echo    %REPO%
echo  Check your internet connection and try again.
echo(
pause
goto END

:END
endlocal
