' loliserver bridge dogrudan baslatici (VBS)
' Bu dosya server.html panelinden tetiklenir.
' Node.js ile loliserver-bridge.js dosyasini calistirir.
Option Explicit
Dim sh, fso, here, node, bridge, args
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here

' Node.js yolunu bul
node = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(node) Then node = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(node) Then node = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\fnm\node-versions\latest\node.exe"
If Not fso.FileExists(node) Then node = "node.exe"

' Bridge yolunu bul
bridge = here & "\loliserver-bridge.js"
If Not fso.FileExists(bridge) Then
  bridge = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\loliserver\loliserver-bridge.js"
End If
If Not fso.FileExists(bridge) Then WScript.Quit(1)

' Eski motor surecini durdur (varsa)
Dim ps
ps = "$t='" & Replace(bridge, "'", "''") & "';$p='27100';$g=Get-CimInstance Win32_Process -Filter 'Name=''node.exe''' | Where-Object {$_.CommandLine -like '*loliserver-bridge*' -and $_.CommandLine -notlike ('*'+$t+'*')}; if($g){ try{ Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 ('http://127.0.0.1:'+$p+'/api/stop') | Out-Null }catch{}; Start-Sleep -Seconds 2; foreach($q in $g){ try{ Stop-Process -Id $q.ProcessId -Force }catch{} }; Start-Sleep -Seconds 1 }"
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -Command """ & ps & """", 0, True

' Motoru baslat
args = """" & node & """ """ & bridge & """ --boot"
sh.Run args, 0, False
