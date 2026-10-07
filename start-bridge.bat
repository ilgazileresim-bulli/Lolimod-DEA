@echo off
chcp 65001 >nul
title loliserver bridge
cd /d "%~dp0"
if exist "loliserver-bridge.js" (
    start "" /min node loliserver-bridge.js --boot
    exit /b 0
)
if exist "%LOCALAPPDATA%\loliserver\loliserver-bridge.js" (
    start "" /min node "%LOCALAPPDATA%\loliserver\loliserver-bridge.js" --boot
    exit /b 0
)
exit /b 1
