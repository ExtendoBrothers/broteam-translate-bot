# PowerShell script to check OAuth2 health and alert if re-auth needed
# Schedule this to run daily via Task Scheduler

$BOT_DIR = "C:\Users\Daniel\broteam-translate-bot"
$LOG_FILE = "$BOT_DIR\.oauth2-health.log"

cd $BOT_DIR

# Run the health check
Write-Output "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - Running OAuth2 health check..." | Out-File -Append $LOG_FILE

npm run build 2>&1 | Out-Null

$output = node dist/scripts/checkOAuth2Health.js 2>&1
$exitCode = $LASTEXITCODE

Write-Output $output | Out-File -Append $LOG_FILE

if ($exitCode -ne 0) {
    # Health check failed - send notification
    Write-Output "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - ❌ OAUTH2 HEALTH CHECK FAILED!" | Out-File -Append $LOG_FILE
    
    # Create a popup notification
    Add-Type -AssemblyName System.Windows.Forms
    $notification = New-Object System.Windows.Forms.NotifyIcon
    $notification.Icon = [System.Drawing.SystemIcons]::Warning
    $notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
    $notification.BalloonTipText = "BroTeam bot needs OAuth2 re-authorization. Run: npm run oauth2:auth"
    $notification.BalloonTipTitle = "Bot Authentication Required"
    $notification.Visible = $true
    $notification.ShowBalloonTip(10000)
    Start-Sleep -Seconds 10
    $notification.Dispose()
    
    Write-Output "OAuth2 health check failed. Please re-authorize:" | Out-Host
    Write-Output "cd $BOT_DIR" | Out-Host
    Write-Output "npm run oauth2:auth" | Out-Host
} else {
    Write-Output "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - ✅ OAuth2 healthy" | Out-File -Append $LOG_FILE
}

exit $exitCode
