@echo off
setlocal
title 36.5 Launcher
powershell.exe -NoLogo -NoProfile -NonInteractive -Command ^
  "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue';" ^
  "$root = Join-Path $env:LOCALAPPDATA '36.5'; $install = Join-Path $root '36.5-v1.2.1-win'; $exe = Join-Path $install '36.5.exe';" ^
  "if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {" ^
  "  Write-Host 'Downloading 36.5 v1.2.1. Please wait...';" ^
  "  New-Item -ItemType Directory -Path $root -Force | Out-Null;" ^
  "  $stage = Join-Path $root ([Guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $stage | Out-Null;" ^
  "  try {" ^
  "    $zip = Join-Path $stage 'game.zip'; $out = Join-Path $stage 'files';" ^
  "    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
  "    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/Leo-2894/36.5/releases/download/v1.2.1/36.5-v1.2.1-Windows.zip' -OutFile $zip;" ^
  "    $stream = [IO.File]::OpenRead($zip); $sha = [Security.Cryptography.SHA256]::Create();" ^
  "    try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', ''); } finally { $stream.Dispose(); $sha.Dispose(); };" ^
  "    if ($hash -ne 'ABC40398E35861FF055B2D883C7DAC38A8B32A6C4DF901107F7A8A41FDF2C28C') { throw 'Download checksum mismatch.' };" ^
  "    Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($zip, $out);" ^
  "    $ready = Join-Path $out '36.5-v1.2.1-win'; if (!(Test-Path -LiteralPath (Join-Path $ready '36.5.exe') -PathType Leaf)) { throw 'Game executable is missing.' };" ^
  "    try { [IO.Directory]::Move($ready, $install) } catch { if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw } };" ^
  "  } finally { if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($stage)) -eq [IO.Path]::GetFullPath($root)) { Remove-Item -LiteralPath $stage -Recurse -Force } };" ^
  "}; Start-Process -FilePath $exe -WorkingDirectory $install;"
if errorlevel 1 (
  echo.
  echo Could not start 36.5. See the error above.
  pause
  exit /b 1
)
exit /b 0
