param(
    [ValidateSet('manual', 'automatic')]
    [string]$Mode
)

# PowerShell script to guarantee a clean build and PM2 restart
# Usage: ./scripts/restart-clean.ps1 [-Mode manual|automatic]

if (-not $Mode) {
    do {
        $selection = (Read-Host "Posting mode: [M]anual (default) or [A]utomatic").Trim().ToLowerInvariant()
        if ($selection -eq '' -or $selection -eq 'm' -or $selection -eq 'manual') { $Mode = 'manual' }
        elseif ($selection -eq 'a' -or $selection -eq 'automatic') { $Mode = 'automatic' }
        else { Write-Host "Choose M or A." }
    } while (-not $Mode)
}

$previousMode = $env:BOT_MODE
$env:BOT_MODE = $Mode
Write-Host "Selected posting mode: $Mode"

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

# ---------------------------------------------------------------------------
# Helper: gracefully shut down all known bot instances before rebuilding.
# Order of operations:
#   1. Gracefully stop and delete the PM2-tracked process
#   2. Stop the locked PID if it is still running
#   3. Hunt for any remaining orphaned node processes running broteam code
#   4. Remove the lock file
# ---------------------------------------------------------------------------
function Stop-AllBotInstances {
    $lockFile = Join-Path $script:RepoRoot ".bot-instance.lock"

    Write-Host "Gracefully stopping PM2 process..."
    pm2 stop broteam-translate-bot 2>$null | Out-Null
    Write-Host "Deleting PM2 process entry..."
    pm2 delete broteam-translate-bot 2>$null | Out-Null

    if (Test-Path $lockFile) {
        try {
            $lockData = Get-Content $lockFile -Raw | ConvertFrom-Json
            $lockedPid = [int]$lockData.pid
            $lockedProcess = Get-Process -Id $lockedPid -ErrorAction SilentlyContinue

            if ($null -ne $lockedProcess) {
                Write-Host "Lock file points to PID $lockedPid - sending graceful shutdown signal..."
                taskkill /PID $lockedPid 2>$null | Out-Null

                $waited = 0
                while ((Get-Process -Id $lockedPid -ErrorAction SilentlyContinue) -and $waited -lt 10) {
                    Start-Sleep -Seconds 1
                    $waited++
                }

                if (Get-Process -Id $lockedPid -ErrorAction SilentlyContinue) {
                    Write-Host "Process $lockedPid did not exit gracefully - force killing..."
                    Stop-Process -Id $lockedPid -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 1
                }
                else {
                    Write-Host "Process $lockedPid exited cleanly."
                }
            }
            else {
                Write-Host "Lock file PID $lockedPid is not running (stale lock)."
            }
        }
        catch {
            Write-Host "Could not parse lock file - skipping PID shutdown."
        }

        Write-Host "Removing lock file..."
        Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
    }

    $orphans = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
        $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        $cmdLine -like "*broteam-translate-bot*"
    }

    if ($orphans) {
        Write-Host "Found $($orphans.Count) orphaned node process(es) - force killing..."
        $orphans | ForEach-Object {
            Write-Host "  Killing PID $($_.Id)"
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 1
    }
    else {
        Write-Host "No orphaned node processes found."
    }

    if (Test-Path $lockFile) {
        Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# Main restart flow
# ---------------------------------------------------------------------------

Write-Host "Fetching latest tags from remote..."
Push-Location $script:RepoRoot
try {

git fetch --tags

Write-Host ""
Write-Host "==> Shutting down all bot instances..."
Stop-AllBotInstances
Write-Host "==> All instances stopped."
Write-Host ""

Write-Host "Removing dist directory..."
Remove-Item -Recurse -Force (Join-Path $script:RepoRoot 'dist') -ErrorAction SilentlyContinue

Write-Host "Building project..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed; bot was not started." }

Write-Host "Updating package.json version..."
node scripts/update-package-version.js

Write-Host "Starting PM2 bot with fresh environment..."
pm2 start ecosystem.config.js --only broteam-translate-bot

if ($LASTEXITCODE -ne 0) {
    throw "PM2 start failed. Verify ecosystem.config.js exists in repo root and PM2 is installed."
}

Write-Host "Starting PM2 dashboard..."
pm2 start ecosystem.config.js --only pm2-dashboard

if ($LASTEXITCODE -ne 0) {
    throw "PM2 dashboard start failed. Verify pm2-dashboard is defined in ecosystem.config.js."
}

Write-Host "Done. Bot is running the latest build with fresh environment."
}
finally {
    $env:BOT_MODE = $previousMode
    Pop-Location
}