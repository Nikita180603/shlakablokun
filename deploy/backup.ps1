# backup.ps1 — резервная копия data/shop.db
$root = (Resolve-Path '.').Path
$backupDir = Join-Path $root 'backups'
if (-not (Test-Path -LiteralPath $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dest = Join-Path $backupDir ("shop-" + $stamp + ".db")
Copy-Item -LiteralPath (Join-Path $root 'data\shop.db') -Destination $dest
Write-Output ("backup: " + $dest)
# Удаляем бэкапы старше 14 дней
Get-ChildItem -LiteralPath $backupDir -Filter 'shop-*.db' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
  Remove-Item -Force
