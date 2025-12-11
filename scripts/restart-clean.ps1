# PowerShell script to guarantee a clean build and PM2 restart
# Usage: ./scripts/restart-clean.ps1

Write-Host "Removing dist directory..."
Remove-Item -Recurse -Force dist

Write-Host "Building project..."
npm run build

Write-Host "Updating package.json version..."
node scripts/update-package-version.js

Write-Host "Restarting PM2 bot with updated environment..."
pm2 restart broteam-translate-bot --update-env

Write-Host "Done. Bot is running the latest build."