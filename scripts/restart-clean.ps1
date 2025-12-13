# PowerShell script to guarantee a clean build and PM2 restart
# Usage: ./scripts/restart-clean.ps1

Write-Host "Removing dist directory..."
Remove-Item -Recurse -Force dist

Write-Host "Building project..."
npm run build

Write-Host "Updating package.json version..."
node scripts/update-package-version.js

Write-Host "Stopping and deleting PM2 bot process..."
pm2 delete broteam-translate-bot 2>$null

Write-Host "Starting PM2 bot with fresh environment..."
pm2 start ecosystem.config.js --only broteam-translate-bot

Write-Host "Done. Bot is running the latest build with fresh environment."