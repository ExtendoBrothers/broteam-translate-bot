# PowerShell script to guarantee a clean build and PM2 restart
# Usage: ./scripts/restart-clean.ps1

# ---------------------------------------------------------------------------
# Helper: gracefully shut down all known bot instances before rebuilding.
# Order of operations:
#   1. Read lock file → SIGTERM the PID → wait up to 10s → force-kill if needed
#   2. Gracefully stop the PM2-tracked process, then delete it
#   3. Hunt for any remaining orphaned node processes running broteam code
#   4. Remove the lock file
# ---------------------------------------------------------------------------
function Stop-AllBotInstances {

    # -- 1. Gracefully shut down the instance named in the lock file ----------
    $lockFile = ".bot-instance.lock"
    if (Test-Path $lockFile) {
        try {
            $lockData = Get-Content $lockFile -Raw | ConvertFrom-Json
            $lockedPid = [int]$lockData.pid
            $lockedProcess = Get-Process -Id $lockedPid -ErrorAction SilentlyContinue
            if ($lockedProcess) {
                Write-Host "Lock file points to PID $lockedPid — sending graceful shutdown signal..."
                # taskkill /PID requests a graceful shutdown (e.g. WM_CLOSE for windowed apps); for headless/PM2 Node
                # processes this may or may not trigger signal handlers, so we follow with a force-kill if needed.
                taskkill /PID $lockedPid 2>$null | Out-Null

                # Wait up to 10 seconds for the process to exit on its own
                $waited = 0
                while ((Get-Process -Id $lockedPid -ErrorAction SilentlyContinue) -and $waited -lt 10) {
                    Start-Sleep -Seconds 1
                    $waited++
                }

                if (Get-Process -Id $lockedPid -ErrorAction SilentlyContinue) {
                    Write-Host "Process $lockedPid did not exit gracefully — force killing..."
                    Stop-Process -Id $lockedPid -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 1
                } else {
                    Write-Host "Process $lockedPid exited cleanly."
                }
            } else {
                Write-Host "Lock file PID $lockedPid is not running (stale lock)."
            }
        } catch {
            Write-Host "Could not parse lock file — skipping PID shutdown."
        }

        Write-Host "Removing lock file..."
        Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
    }

    # -- 2. Gracefully stop + delete the PM2-tracked process ------------------
    Write-Host "Gracefully stopping PM2 process..."
    pm2 stop broteam-translate-bot 2>$null | Out-Null
    Start-Sleep -Seconds 3
    Write-Host "Deleting PM2 process entry..."
    pm2 delete broteam-translate-bot 2>$null | Out-Null
    Start-Sleep -Seconds 2

    # -- 3. Kill any remaining orphaned node processes for this bot -----------
    # Match only processes whose command line references THIS project's directory
    # to avoid accidentally killing node processes from other workspaces.
    $orphans = Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
        $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        $cmdLine -like "*broteam-translate-bot*"
    }
    if ($orphans) {
        Write-Host "Found $($orphans.Count) orphaned node process(es) — force killing..."
        $orphans | ForEach-Object {
            Write-Host "  Killing PID $($_.Id)"
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 1
    } else {
        Write-Host "No orphaned node processes found."
    }

    # -- 4. Final lock file check (in case another process recreated it) ------
    if (Test-Path $lockFile) {
        Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# Main restart flow
# ---------------------------------------------------------------------------

Write-Host "Fetching latest tags from remote..."
git fetch --tags

Write-Host ""
Write-Host "==> Shutting down all bot instances..."
Stop-AllBotInstances
Write-Host "==> All instances stopped."
Write-Host ""

Write-Host "Removing dist directory..."
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue

Write-Host "Building project..."
npm run build

Write-Host "Updating package.json version..."
node scripts/update-package-version.js

Write-Host "Starting PM2 bot with fresh environment..."
pm2 start ecosystem.config.js --only broteam-translate-bot

Write-Host "Done. Bot is running the latest build with fresh environment."