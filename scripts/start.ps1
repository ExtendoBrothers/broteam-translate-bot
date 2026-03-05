# BroTeam Translate Bot - Windows startup script
# Usage: ./scripts/start.ps1           — detach and return to terminal
#        ./scripts/start.ps1 -Background — run the restart loop (called internally)
[CmdletBinding()]
param(
    [switch]$Background
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Repo root (derive from this script's directory to avoid hardcoded usernames)
$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path $repo)) { throw "Repo path not found: $repo" }

# Ensure working directory
Set-Location $repo

# Ensure live mode unless overridden by system policy
if (-not $env:DRY_RUN) { $env:DRY_RUN = '0' }

# Optional: echo versions for diagnostics
try { $nodeVer = node --version; Write-Host "Node: $nodeVer" } catch { Write-Host "Node not found in PATH" }

# Check if bot is already running via lock file
$lockFile = Join-Path $repo '.bot-instance.lock'
if (Test-Path $lockFile) {
    try {
        $lockData = Get-Content $lockFile | ConvertFrom-Json
        if (-not $lockData -or -not $lockData.pid) {
            Write-Host "Lock file missing PID, removing it."
            Remove-Item $lockFile
        } else {
            $existingPid = [int]$lockData.pid
            if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
                Write-Host "Bot is already running (PID: $existingPid). Exiting."
                exit 0
            } else {
                Write-Host "Removing stale lock file from PID $existingPid."
                Remove-Item $lockFile
            }
        }
    } catch {
        Write-Host "Error reading lock file, removing it."
        Remove-Item $lockFile
    }
}

if (-not $Background) {
    # ── Foreground call: spawn a detached hidden process and return ──────────
    # The spawned process runs this same script with -Background, so it keeps
    # running independently of this terminal session.
    $scriptPath = $PSCommandPath
    $pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
    if (-not $pwsh) { $pwsh = (Get-Command powershell).Source }

    # Pass through any custom env vars the caller may have set
    $envBlock = @{}
    if ($env:DRY_RUN)  { $envBlock['DRY_RUN']  = $env:DRY_RUN }
    if ($env:FETCH_METHOD) { $envBlock['FETCH_METHOD'] = $env:FETCH_METHOD }

    $argList = "-NonInteractive -WindowStyle Hidden -File `"$scriptPath`" -Background"
    $proc = Start-Process -FilePath $pwsh -ArgumentList $argList `
                          -WorkingDirectory $repo `
                          -WindowStyle Hidden -PassThru

    Write-Host "Bot started in background (PID: $($proc.Id)). Terminal is free."
    Write-Host "To stop: Stop-Process -Id $($proc.Id) -Force"
    exit 0
}

# ── Background mode: run the restart loop ────────────────────────────────────
Write-Host "Starting BroTeam Translate Bot with auto-restart..."

while ($true) {
    try {
        $proc = Start-Process -FilePath "node" -ArgumentList "dist/src/index.js" `
                              -NoNewWindow -PassThru -Wait
        $code = $proc.ExitCode
    } catch {
        $code = -1
    }
    if ($code -eq 0) {
        Write-Host "Bot exited cleanly (code 0)."
        break
    }
    if ($code -eq 1) {
        Write-Host "Bot exited with code 1 (another instance running). Not restarting."
        break
    }
    Write-Host "Bot exited with code $code. Restarting in 10s..."
    Start-Sleep -Seconds 10
}
