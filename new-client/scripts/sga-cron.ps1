$ErrorActionPreference = "Stop"

$secret = $env:CRON_SECRET
if (-not $secret) {
  Write-Error "CRON_SECRET env var is required."
}

$url = $env:SGA_CRON_URL
if (-not $url) {
  $url = "http://localhost:3000/api/sga/cron"
}

Write-Host "Calling $url"
Invoke-RestMethod -Method Get -Uri $url -Headers @{ Authorization = "Bearer $secret" }
