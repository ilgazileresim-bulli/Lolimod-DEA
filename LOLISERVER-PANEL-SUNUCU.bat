@echo off
chcp 65001 >nul
title loliserver panel sunucusu (Google girisi icin http)
cd /d "%~dp0"
set "PNODE="
where node >nul 2>nul && set "PNODE=node"
if not defined PNODE if exist "C:\Program Files\nodejs\node.exe" set "PNODE=C:\Program Files\nodejs\node.exe"
if not defined PNODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PNODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined PNODE if exist "%LOCALAPPDATA%\fnm\node-versions\latest\node.exe" set "PNODE=%LOCALAPPDATA%\fnm\node-versions\latest\node.exe"
if not defined PNODE (
    echo Node.js bulunamadi. Lutfen Node.js yukleyin: https://nodejs.org
    pause
    exit /b 1
)
echo loliserver panel sunucusu baslatiliyor... (kapatmak icin bu pencereyi kapatin)
"%PNODE%" panel-server.js
pause
