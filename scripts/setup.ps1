# BroTeam Translate Bot - one-click setup
# Usage: ./scripts/setup.ps1   (or: npm run setup)
#
# Verifies prerequisites, installs npm deps, creates .env, brings up
# LibreTranslate via Docker, and builds the project so it's ready to run.
[CmdletBinding()]
param(
    [switch]$SkipDocker
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "!! $msg" -ForegroundColor Yellow }
function Write-Ok($msg)   { Write-Host "OK $msg" -ForegroundColor Green }

# ---------------------------------------------------------------------------
# 1. Node.js version check (requires >=18, per package.json "engines")
# ---------------------------------------------------------------------------
Write-Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js not found in PATH. Install Node.js 18+ from https://nodejs.org and re-run this script."
}
$nodeVersion = (node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 18) {
    throw "Node.js $nodeVersion detected, but v18+ is required. Install a newer version from https://nodejs.org."
}
Write-Ok "Node.js v$nodeVersion"

# ---------------------------------------------------------------------------
# 2. Install npm dependencies
# ---------------------------------------------------------------------------
Write-Step "Installing npm dependencies (npm ci)"
if (Test-Path (Join-Path $repo 'package-lock.json')) {
    npm ci
} else {
    npm install
}
Write-Ok "Dependencies installed"

# ---------------------------------------------------------------------------
# 3. Create .env from .env.example if missing
# ---------------------------------------------------------------------------
Write-Step "Checking .env file"
$envPath = Join-Path $repo '.env'
$envExamplePath = Join-Path $repo '.env.example'
if (Test-Path $envPath) {
    Write-Ok ".env already exists, leaving it untouched"
} elseif (Test-Path $envExamplePath) {
    Copy-Item $envExamplePath $envPath
    Write-Ok "Created .env from .env.example (edit it to add any credentials you need)"
} else {
    Write-Warn ".env.example not found, skipping .env creation"
}

# ---------------------------------------------------------------------------
# 4. Docker / LibreTranslate
# ---------------------------------------------------------------------------
if ($SkipDocker) {
    Write-Warn "Skipping Docker setup (-SkipDocker passed). Start LibreTranslate manually before running the bot."
} else {
    Write-Step "Checking Docker"
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        Write-Warn "Docker not found in PATH. Install Docker Desktop from https://www.docker.com/products/docker-desktop then run:"
        Write-Warn "  docker-compose up -d libretranslate"
    } else {
        try {
            docker info *> $null
        } catch {
            throw "Docker is installed but not running. Start Docker Desktop and re-run this script."
        }
        Write-Ok "Docker is running"

        Write-Step "Starting LibreTranslate container (docker-compose up -d libretranslate)"
        docker-compose up -d libretranslate

        Write-Step "Waiting for LibreTranslate to become healthy (this can take a few minutes on first run while it downloads language models)"
        $ready = $false
        for ($i = 0; $i -lt 60; $i++) {
            try {
                $resp = Invoke-WebRequest -Uri 'http://localhost:5000/languages' -TimeoutSec 3 -UseBasicParsing
                if ($resp.StatusCode -eq 200) { $ready = $true; break }
            } catch { }
            Start-Sleep -Seconds 5
        }
        if ($ready) {
            Write-Ok "LibreTranslate is up at http://localhost:5000"
        } else {
            Write-Warn "LibreTranslate isn't responding yet. Check progress with: docker logs -f libretranslate"
        }
    }
}

# ---------------------------------------------------------------------------
# 5. Build TypeScript
# ---------------------------------------------------------------------------
Write-Step "Building project (npm run build)"
npm run build
Write-Ok "Build complete"

# ---------------------------------------------------------------------------
# 6. Done
# ---------------------------------------------------------------------------
Write-Step "Setup complete"
Write-Host "Local run:            npm start   (or npm run dev for auto-reload)"
Write-Host "Deployment/restart:   ./scripts/restart-clean.ps1"
Write-Host "Dashboard:           http://localhost:3456"
