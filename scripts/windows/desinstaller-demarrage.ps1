# Retire le démarrage automatique de Vigie (tâche planifiée « Vigie »).
$task = Get-ScheduledTask -TaskName 'Vigie' -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName 'Vigie' -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName 'Vigie' -Confirm:$false
  Write-Host 'Démarrage automatique de Vigie retiré.' -ForegroundColor Green
} else {
  Write-Host 'Aucune tâche « Vigie » à retirer.'
}
