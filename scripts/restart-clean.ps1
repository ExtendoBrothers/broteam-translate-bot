# PowerShell script to guarantee a clean build and PM2 restart
# Usage: ./scripts/restart-clean.ps1

Write-Host "Fetching latest tags from remote..."
git fetch --tags

Write-Host "Removing dist directory..."
Remove-Item -Recurse -Force dist

Write-Host "Building project..."
npm run build

Write-Host "Updating package.json version..."
node scripts/update-package-version.js

Write-Host "Stopping and deleting PM2 bot process..."
pm2 delete broteam-translate-bot 2>$null

Write-Host "Waiting for process to fully exit..."
Start-Sleep -Seconds 3

# Clean up lock file if it exists (handles case where process crashed)
if (Test-Path ".bot-instance.lock") {
    Write-Host "Removing stale lock file..."
    Remove-Item -Force .bot-instance.lock
}

# Verify no orphaned Node processes
$orphans = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
    $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue).CommandLine
    $cmdLine -like "*broteam*" -or $cmdLine -like "*dist\src\index.js*"
}
if ($orphans) {
    Write-Host "⚠️  Found orphaned processes, killing..."
    $orphans | Stop-Process -Force
    Start-Sleep -Seconds 1
}

Write-Host "Starting PM2 bot with fresh environment..."
pm2 start ecosystem.config.js --only broteam-translate-bot

Write-Host "Done. Bot is running the latest build with fresh environment."