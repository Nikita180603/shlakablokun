# windows-service.ps1 — пример регистрации службы через NSSM (https://nssm.cc)
# Требуется установленный nssm.exe в PATH.
param(
  [string]$ServiceName = "KamenniyDvor",
  [string]$Root = (Resolve-Path '.').Path
)

$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) { Write-Error "nssm not found in PATH"; exit 1 }

& nssm install $ServiceName (Join-Path $Root 'kd-server.exe')
& nssm set $ServiceName AppDirectory $Root
& nssm set $ServiceName AppStdout (Join-Path $Root 'logs\service.log')
& nssm set $ServiceName AppStderr (Join-Path $Root 'logs\service.log')
if (-not (Test-Path -LiteralPath (Join-Path $Root 'logs'))) { New-Item -ItemType Directory -Path (Join-Path $Root 'logs') | Out-Null }
Write-Output "service installed: $ServiceName"
Write-Output "start with: nssm start $ServiceName"
