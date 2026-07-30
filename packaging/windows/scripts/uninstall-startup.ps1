$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Bangumi Watch Planner.lnk'
Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
Write-Host "Startup disabled."
