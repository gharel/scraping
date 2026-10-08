# Lance Vigie automatiquement à l'ouverture de session Windows (tâche planifiée « Vigie »).
# Utilisation : clic droit > Exécuter avec PowerShell, ou :
#   powershell -ExecutionPolicy Bypass -File scripts\windows\installer-demarrage.ps1
# Pour retirer la tâche : scripts\windows\desinstaller-demarrage.ps1

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host 'Node.js est introuvable. Installez-le depuis https://nodejs.org puis relancez ce script.' -ForegroundColor Red
  exit 1
}
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host 'Installation des dépendances...'
  Push-Location $root
  npm install --no-audit --no-fund
  Pop-Location
}

$command = "Set-Location -LiteralPath '$root'; & '$node' 'server\local.js' --no-open"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$command`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName 'Vigie' -Action $action -Trigger $trigger -Settings $settings -Description 'Veille automatique des appels d''offres (Vigie)' -Force | Out-Null
Start-ScheduledTask -TaskName 'Vigie'
Write-Host 'Vigie démarrera désormais à chaque ouverture de session.' -ForegroundColor Green
Write-Host 'Interface : http://localhost:4700'
