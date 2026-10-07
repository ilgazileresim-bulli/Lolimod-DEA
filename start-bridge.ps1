# loliserver bridge direkt baslatici (PowerShell)
# server.html panelinden tetiklenir
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

# Bridge dosyasini bul
$bridge = Join-Path $here "loliserver-bridge.js"
if (-not (Test-Path $bridge)) {
    $bridge = Join-Path $env:LOCALAPPDATA "loliserver\loliserver-bridge.js"
}
if (-not (Test-Path $bridge)) { exit 1 }

# Eski motoru durdur
$old = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*loliserver-bridge*" -and $_.CommandLine -notlike "*$bridge*" }
if ($old) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 "http://127.0.0.1:27100/api/stop" -ErrorAction SilentlyContinue | Out-Null } catch {}
    Start-Sleep -Seconds 2
    $old | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# Motoru baslat
Start-Process node -ArgumentList @("""$bridge""", "--boot") -WindowStyle Hidden -WorkingDirectory $here
