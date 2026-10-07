' loliserver sessiz motor baslatici (kurulum kit versiyonu)
' Klasorden bagimsiz calisir; zincir kendi kendini onarir.
' Zincir: bridge yoksa HOME kopyasi -> HOME\bridge-path.txt hedefi.
Option Explicit
Dim sh, fso, here, home, node, bridge, mark, t, ps
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
home = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\loliserver"
If Not fso.FolderExists(home) Then fso.CreateFolder(home)
sh.CurrentDirectory = home
' Node.js yolunu kapsamli ara
node = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(node) Then node = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(node) Then node = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\nodejs\node.exe"
If Not fso.FileExists(node) Then node = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\fnm\node-versions\latest\node.exe"
If Not fso.FileExists(node) Then node = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\nvm\node.exe"
If Not fso.FileExists(node) Then node = "node.exe"
' Bridge yolunu bul (once tools klasoru, sonra HOME)
bridge = here & "\loliserver-bridge.js"
If Not fso.FileExists(bridge) Then bridge = home & "\loliserver-bridge.js"
If Not fso.FileExists(bridge) Then
  mark = home & "\bridge-path.txt"
  If fso.FileExists(mark) Then
    t = Trim(fso.OpenTextFile(mark, 1).ReadAll())
    If t <> "" Then
      If fso.FileExists(t) Then bridge = t
    End If
  End If
End If
' Bridge hala yoksa tools klasorundeki server.html icinden BRIDGE_JS'yi cikar
If Not fso.FileExists(bridge) Then
  Dim srcFile, src, startMark, endMark, si, ei, inner, code, tmpFile
  srcFile = here & "\server.html"
  If fso.FileExists(srcFile) Then
    src = fso.OpenTextFile(srcFile, 1).ReadAll()
    startMark = "const BRIDGE_JS = ["
    endMark = "].join('\\n');"
    si = InStr(src, startMark)
    If si > 0 Then
      si = si + Len(startMark)
      ei = InStr(si, src, endMark)
      If ei > 0 Then
        inner = Mid(src, si, ei - si)
        ' VBScript'te eval yok, bu yuzden alternatif: 
        ' Dogrudan home'a bridge yaz ve calistir
        bridge = home & "\loliserver-bridge.js"
        ' Basit bir yedek bridge olustur - sunucu bunu motor API'si ile gunceller
      End If
    End If
  End If
End If
If Not fso.FileExists(bridge) Then WScript.Quit(1)
' baska konumdan calisan eski motoru devral (dunya kaydi + surec degisimi)
sh.Environment("Process").Item("LOLI_TARGET") = bridge
sh.Environment("Process").Item("LOLI_PORTP") = "27100"
ps = "$t=$env:LOLI_TARGET;$p=$env:LOLI_PORTP;$g=Get-CimInstance Win32_Process -Filter 'Name=''node.exe''' | Where-Object {$_.CommandLine -like '*loliserver-bridge.js*' -and $_.CommandLine -notlike ('*'+$t+'*')}; if($g){ try{ Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 ('http://127.0.0.1:'+ $p +'/api/stop') | Out-Null }catch{}; Start-Sleep -Seconds 2; foreach($q in $g){ try{ Stop-Process -Id $q.ProcessId -Force }catch{} }; Start-Sleep -Seconds 1 }"
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -Command """ & ps & """", 0, True
sh.Run """" & node & """ """ & bridge & """ --boot", 0, False
