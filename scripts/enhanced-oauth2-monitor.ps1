# Enhanced OAuth2 monitoring with automated actions
# This script runs the health check and can take automated actions

param(
    [switch]$AutoRestart,
    [switch]$SendNotification
)

$BotName = "broteam-translate-bot"
$HealthCheckScript = Join-Path $PSScriptRoot "..\src\scripts\checkOAuth2Health.ts"

Write-Host "Running OAuth2 health check..." -ForegroundColor Cyan

# Run the health check
try {
    & npm run oauth2:check 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0) {
        Write-Host "✅ OAuth2 tokens are healthy" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "❌ OAuth2 health check failed (exit code: $exitCode)" -ForegroundColor Red

        if ($AutoRestart) {
            Write-Host "Attempting to restart bot..." -ForegroundColor Yellow

            # Stop the bot
            & pm2 delete $BotName 2>$null

            # Wait a moment
            Start-Sleep -Seconds 2

            # Try to start with OAuth1 fallback (if configured)
            Write-Host "Starting bot with OAuth1 fallback..." -ForegroundColor Yellow
            & pm2 start ecosystem.config.js --only $BotName

            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Bot restarted successfully with OAuth1 fallback" -ForegroundColor Green
            } else {
                Write-Host "❌ Bot restart failed" -ForegroundColor Red
            }
        }

        if ($SendNotification) {
            # Create a Windows notification
            $title = "BroTeam Bot: OAuth2 Token Issue"
            $message = "OAuth2 tokens need refresh. Run: npm run oauth2:auth"

            # Use Windows toast notification
            $xml = @"
<toast>
    <visual>
        <binding template="ToastGeneric">
            <text>$title</text>
            <text>$message</text>
        </binding>
    </visual>
    <actions>
        <action content="Run OAuth2 Auth" arguments="npm run oauth2:auth" activationType="protocol"/>
    </actions>
</toast>
"@

            # Save XML to temp file and show notification
            $tempFile = [System.IO.Path]::GetTempFileName() + ".xml"
            $xml | Out-File -FilePath $tempFile -Encoding UTF8

            try {
                & "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "& { [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null; `$xml = New-Object Windows.Data.Xml.Dom.XmlDocument; `$xml.LoadXml((Get-Content '$tempFile' -Raw)); `$toast = New-Object Windows.UI.Notifications.ToastNotification `$xml; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('BroTeam Bot').Show(`$toast); }"
            } catch {
                Write-Host "Could not send Windows notification: $_" -ForegroundColor Yellow
            } finally {
                Remove-Item $tempFile -ErrorAction SilentlyContinue
            }
        }

        exit 1
    }
} catch {
    Write-Host "❌ Error running health check: $_" -ForegroundColor Red
    exit 1
}