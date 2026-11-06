# setup-backup-task.ps1 — регистрирует ежедневный бэкап в Планировщике задач Windows
param(
  [string]$TaskName = "KamenniyDvorBackup",
  [string]$Root = (Resolve-Path '.').Path,
  [string]$Time = "03:00"
)

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Root\deploy\backup.ps1`"" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable:$false
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Output "scheduled task created: $TaskName at $Time"
