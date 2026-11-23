@echo off
setlocal
set "GAME_DIR=%~dp036.5"
set "GAME_EXE=%GAME_DIR%\36.5.exe"
if not exist "%GAME_DIR%\resources\app.asar" goto failed
if exist "%GAME_EXE%" (
  for %%I in ("%GAME_EXE%") do if %%~zI GTR 1024 goto launch
)
echo Preparing the bundled game executable...
powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $env:GAME_DIR 'runtime-exe.zip')); try { $entry = $zip.GetEntry('36.5.exe'); $bytes = $entry.Open(); $sha = [Security.Cryptography.SHA256]::Create(); try { $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '') } finally { $bytes.Dispose(); $sha.Dispose() }; if ($hash -ne '0CEB2965D9EE574BB3006132D30EE177EE9AF741F135EA82549D5103608EDD13') { throw 'Game executable checksum mismatch.' }; [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $env:GAME_EXE, $true) } finally { $zip.Dispose() }"
if errorlevel 1 goto failed
:launch
start "" /d "%GAME_DIR%" "%GAME_EXE%"
if errorlevel 1 goto failed
exit /b 0
:failed
echo Could not start 36.5. Extract the entire ZIP to a writable folder, then try again.
pause
exit /b 1
