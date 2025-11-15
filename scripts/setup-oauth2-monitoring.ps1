# Setup Windows Task Scheduler to run OAuth2 health check daily
# This script will prompt for admin rights if needed

$TaskName = "BroTeam-OAuth2-HealthCheck"
$ScriptPath = "C:\Users\Daniel\broteam-translate-bot\scripts\check-oauth2-health.ps1"
$Description = "Daily health check for BroTeam bot OAuth2 tokens"

Write-Host "Setting up automated OAuth2 health monitoring..." -ForegroundColor Cyan
Write-Host "This will create a scheduled task that runs daily at 9:00 AM`n" -ForegroundColor White

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "⚠️  This script requires administrator privileges." -ForegroundColor Yellow
    Write-Host "Attempting to restart with admin rights...`n" -ForegroundColor Yellow
    
    # Re-run this script with admin rights
    Start-Process PowerShell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Wait
    exit
}

# Check if task already exists
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($existingTask) {
    Write-Host "Task '$TaskName' already exists. Removing..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Create the action (run PowerShell script)
$Action = New-ScheduledTaskAction -Execute "PowerShell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""

# Create the trigger (daily at 9 AM)
$Trigger = New-ScheduledTaskTrigger -Daily -At 9AM

# Create the principal (run as current user, no admin required)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U

# Create the settings
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RunOnlyIfNetworkAvailable

# Register the task
try {
    Register-ScheduledTask -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Principal $Principal `
        -Settings $Settings `
        -Description $Description | Out-Null

    Write-Host "`n✅ Task scheduled successfully!" -ForegroundColor Green
    Write-Host "The OAuth2 health check will run daily at 9:00 AM" -ForegroundColor Cyan
    Write-Host "`nYou can also run it manually with:" -ForegroundColor White
    Write-Host "  npm run oauth2:check" -ForegroundColor Yellow
    Write-Host "`nTo view the task in Task Scheduler:" -ForegroundColor White
    Write-Host "  taskschd.msc" -ForegroundColor Yellow
    Write-Host "`nTo run the task immediately (test):" -ForegroundColor White
    Write-Host "  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Yellow
    
    # Test the task
    Write-Host "`nRunning test now..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 3
    Write-Host "✅ Test complete! Check .oauth2-health.log for results" -ForegroundColor Green
} catch {
    Write-Host "`n❌ Failed to create scheduled task: $_" -ForegroundColor Red
    Write-Host "`nYou can still run the health check manually:" -ForegroundColor Yellow
    Write-Host "  npm run oauth2:check" -ForegroundColor White
}

Write-Host "`nPress any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
