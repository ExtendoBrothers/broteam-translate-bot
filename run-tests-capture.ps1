# PowerShell script to run tests and capture output
$ErrorActionPreference = "Continue"

Write-Host "Running npm test..." -ForegroundColor Yellow

# Run npm test and capture both stdout and stderr
$output = & npm test 2>&1 | Out-String

# Save to file
$output | Out-File "test-output-full.txt" -Encoding UTF8

# Display summary
Write-Host "`n=== TEST OUTPUT SUMMARY ===" -ForegroundColor Cyan
Write-Host "Full output saved to test-output-full.txt" -ForegroundColor Green
Write-Host "`nLast 100 lines:" -ForegroundColor Yellow
Get-Content "test-output-full.txt" -Tail 100

# Check for failures
if ($output -match "FAIL|failed|error") {
    Write-Host "`n⚠️ Tests appear to have failures" -ForegroundColor Red
    
    # Extract failure information
    $failures = $output -split "`n" | Where-Object { $_ -match "FAIL|● |Error:" }
    Write-Host "`nFailure lines:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "`n✅ No obvious failures detected" -ForegroundColor Green
}

# Return exit code
if ($LASTEXITCODE -ne 0) {
    Write-Host "`nTests exited with code: $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}
