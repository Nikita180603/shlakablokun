# backup.ps1 — резервная копия базы и фото товаров
$root = (Resolve-Path '.').Path
$backupDir = Join-Path $root 'backups'
if (-not (Test-Path -LiteralPath $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dest = Join-Path $backupDir ("shop-" + $stamp + ".db")
Copy-Item -LiteralPath (Join-Path $root 'data\shop.db') -Destination $dest
Write-Output ("backup: " + $dest)

# Фото, загруженные из админки.
$photos = Join-Path $root 'img\custom'
if (Test-Path -LiteralPath $photos) {
  $photosDest = Join-Path $backupDir ("photos-" + $stamp)
  Copy-Item -LiteralPath $photos -Destination $photosDest -Recurse
  Write-Output ("backup: " + $photosDest)
}

# Удаляем бэкапы старше 14 дней
Get-ChildItem -LiteralPath $backupDir -Filter 'shop-*.db' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
  Remove-Item -Force
Get-ChildItem -LiteralPath $backupDir -Filter 'photos-*' -Directory |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
  Remove-Item -Recurse -Force
