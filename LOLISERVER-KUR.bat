@echo off
chcp 65001 >nul
title loliserver motor kurulumu
rem ONARIM KITI: motor zinciri bozulduysa bir kez cift tikla, her sey kendini kurar.
rem Yonetici gerekmez; kayitlar HKCU ve kullanici klasorlerine yapilir.
set "LHOME=%LOCALAPPDATA%\loliserver"
echo [1/6] Motor klasoru hazirlaniyor: %LHOME%
if not exist "%LHOME%" mkdir "%LHOME%"
echo [2/6] Motor dosyalari kopyalaniyor...
copy /y "%~dp0loliserver-bridge.js" "%LHOME%\loliserver-bridge.js" >nul 2>nul
copy /y "%~dp0loli-start.vbs" "%LHOME%\loli-start.vbs" >nul 2>nul
copy /y "%~dp0start-bridge.vbs" "%LHOME%\start-bridge.vbs" >nul 2>nul
copy /y "%~dp0start-bridge.bat" "%LHOME%\start-bridge.bat" >nul 2>nul
copy /y "%~dp0start-bridge.ps1" "%LHOME%\start-bridge.ps1" >nul 2>nul
echo [3/6] loliserver:// protokolu kaydediliyor (HKCU)...
reg add "HKCU\Software\Classes\loliserver" /ve /d "URL:loliserver Motoru" /f >nul
reg add "HKCU\Software\Classes\loliserver" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\loliserver\shell\open\command" /ve /d "wscript.exe \"%LHOME%\loli-start.vbs\"" /f >nul
echo [4/6] Oturum acilisinda otomatik baslatma kuruluyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut($env:APPDATA+'\Microsoft\Windows\Start Menu\Programs\Startup\loliserver motoru.lnk');$q=[char]34;$s.TargetPath='wscript.exe';$s.Arguments=($q+$env:LOCALAPPDATA+'\loliserver\loli-start.vbs'+$q);$s.WorkingDirectory=($env:LOCALAPPDATA+'\loliserver');$s.WindowStyle=7;$s.Description='loliserver motoru';$s.Save()"
echo [5/6] Eski motor durduruluyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$p=Get-Process -Name node -ErrorAction SilentlyContinue|?{$_.CommandLine -like '*loliserver-bridge*'};if($p){try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://127.0.0.1:27100/api/stop'|Out-Null}catch{};Start-Sleep 2;$p|Stop-Process -Force -ErrorAction SilentlyContinue}}catch{}" >nul 2>nul
echo [6/6] Motor baslatiliyor (eski motor varsa dunya kaydedilip devralinir)...
wscript.exe "%LHOME%\loli-start.vbs"
timeout /t 3 >nul
echo.
echo KURULUM TAMAM. Panel aciliyor...
rem Google ile giris yalnizca http(s) adresinden calisir; paneli once kucuk web sunucusu ile acmayi dene.
set "PNODE="
where node >nul 2>nul && set "PNODE=node"
if not defined PNODE if exist "C:\Program Files\nodejs\node.exe" set "PNODE=C:\Program Files\nodejs\node.exe"
if not defined PNODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PNODE=%ProgramFiles(x86)%\nodejs\node.exe"
if defined PNODE (
    start "" /min "%PNODE%" "%~dp0panel-server.js" --no-open
    timeout /t 2 >nul
    start "" "http://localhost:27200/server.html#/panel"
) else (
    start "" "%~dp0server.html#/panel"
)
echo Bu dosyaya bir daha ihtiyac duyulmaz; motor her oturumda kendiliginden acilir.
echo Ayrica start-bridge.vbs veya start-bridge.bat dosyasina cift tiklayarak da motoru calistirabilirsin.
pause
