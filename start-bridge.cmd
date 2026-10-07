@echo off
chcp 65001 >nul
title loliserver bridge
cd /d "%~dp0"
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Node.js bulunamadi. Lutfen Node.js yukleyin: https://nodejs.org
    pause
    exit /b 1
)
if exist "loliserver-bridge.js" (
    start "" /min node loliserver-bridge.js --boot
    echo loliserver bridge baslatildi.
    exit /b 0
)
if exist "%LOCALAPPDATA%\loliserver\loliserver-bridge.js" (
    start "" /min node "%LOCALAPPDATA%\loliserver\loliserver-bridge.js" --boot
    echo loliserver bridge baslatildi (HOME).
    exit /b 0
)
echo loliserver-bridge.js bulunamadi!
echo.
echo Cozum: LOLISERVER-KUR.bat dosyasini calistir.
pause
exit /b 1
