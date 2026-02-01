# BroTeam Translate Bot - Windows startup script
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

# Check if bot is already running
$lockFile = Join-Path $repo '.bot-instance.lock'
if (Test-Path $lockFile) {
    try {
        $lockData = Get-Content $lockFile | ConvertFrom-Json
        if (-not $lockData -or -not $lockData.pid) {
            Write-Host "Lock file missing PID, removing it."
            Remove-Item $lockFile
        } else {
            $pid = [int]$lockData.pid
            if (Get-Process -Id $pid -ErrorAction SilentlyContinue) {
                Write-Host "Bot is already running (PID: $pid). Exiting."
                exit 0
            } else {
                Write-Host "Removing stale lock file from PID $pid."
                Remove-Item $lockFile
            }
        }
    } catch {
        Write-Host "Error reading lock file, removing it."
        Remove-Item $lockFile
    }
}

# Start the bot
Write-Host "Starting BroTeam Translate Bot with auto-restart..."

# Run the bot with auto-restart on non-zero exit
while ($true) {
	try {
		$proc = Start-Process -FilePath "node" -ArgumentList "dist/src/index.js" -NoNewWindow -PassThru -Wait
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
