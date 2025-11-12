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

# Start the bot
Write-Host "Starting BroTeam Translate Bot with auto-restart..."

# Run the bot with auto-restart on non-zero exit
while ($true) {
	try {
		$proc = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -NoNewWindow -PassThru -Wait
		$code = $proc.ExitCode
	} catch {
		$code = -1
	}
	if ($code -eq 0) {
		Write-Host "Bot exited cleanly (code 0)."
		break
	}
	Write-Host "Bot exited with code $code. Restarting in 10s..."
	Start-Sleep -Seconds 10
}
