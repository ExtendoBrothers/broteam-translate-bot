Param(
  [switch]$NoStartup
)

Write-Host "[migrate-to-pm2] Starting migration to PM2..."

# Resolve repo root from this script's folder
$repoRoot = (Get-Item $PSScriptRoot).Parent.FullName
Set-Location $repoRoot
Write-Host "[migrate-to-pm2] Repo root: $repoRoot"

# Ensure pm2 is available
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Write-Host "[migrate-to-pm2] PM2 not found. Installing pm2 and pm2-windows-startup globally..."
  npm install -g pm2 pm2-windows-startup
}

# Stop any PM2 process with our app name (ignore errors)
try { pm2 stop broteam-translate-bot | Out-Null } catch { }
try { pm2 delete broteam-translate-bot | Out-Null } catch { }

# Stop any existing Node process running this bot directly
try {
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    ($_.CommandLine -match [regex]::Escape("$repoRoot\\dist\\index.js")) -or
    ($_.CommandLine -match [regex]::Escape("$repoRoot\\src\\index.ts")) -or
    ($_.CommandLine -match 'ts-node')
  }
  foreach ($p in $procs) {
    Write-Host "[migrate-to-pm2] Stopping node PID $($p.ProcessId) ..."
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
} catch { }

# Handle stale lock
$lockPath = Join-Path $repoRoot '.bot-instance.lock'
if (Test-Path $lockPath) {
  try {
    $lockObj = Get-Content $lockPath -Raw | ConvertFrom-Json
    if ($lockObj.pid) {
      Write-Host "[migrate-to-pm2] Attempting to stop lock PID $($lockObj.pid) ..."
      Stop-Process -Id $lockObj.pid -ErrorAction SilentlyContinue
    }
  } catch { }
  try {
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
    Write-Host "[migrate-to-pm2] Removed .bot-instance.lock"
  } catch { }
}

# Build the app
Write-Host "[migrate-to-pm2] Building app..."
npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Error "[migrate-to-pm2] Build failed. Aborting."
  exit 1
}

# Start with PM2 using ecosystem file if present, otherwise direct
$ecos = Join-Path $repoRoot 'ecosystem.config.js'
if (Test-Path $ecos) {
  Write-Host "[migrate-to-pm2] Starting with PM2 (ecosystem.config.js)..."
  pm2 start $ecos | Out-Host
} else {
  Write-Host "[migrate-to-pm2] ecosystem.config.js not found; starting dist/src/index.js directly..."
  pm2 start (Join-Path $repoRoot 'dist/src/index.js') --name broteam-translate-bot --cwd $repoRoot --update-env --time --no-autorestart:$false | Out-Host
}

pm2 status | Out-Host
pm2 logs broteam-translate-bot --lines 20 | Out-Host

if (-not $NoStartup) {
  Write-Host "[migrate-to-pm2] Enabling startup and saving process list..."
  try { pm2 save | Out-Host } catch { }
  try { pm2-startup install | Out-Host } catch { Write-Warning "pm2-startup install may require elevated privileges." }
}

Write-Host "[migrate-to-pm2] Migration complete. Use 'pm2 status' and 'pm2 logs broteam-translate-bot' for monitoring."
