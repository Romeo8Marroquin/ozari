# Load secret VALUES into Secret Manager as new versions (PowerShell).
#
# This script contains NO secret values. It reads them from a local, GITIGNORED file:
#   infrastructure/secrets/staging.env
#
# Expected file format (KEY=VALUE, one per line; '#' comments allowed):
#   DATABASE_URL=postgres://...
#   DIRECT_DATABASE_URL=postgres://...
#   JWT_SECRET=...
#   JWT_REFRESH_SECRET=...
#   ENCRYPTION_KEY=...            # 32-byte hex
#   API_KEY=...
#
# Terraform manages the secret CONTAINERS; this script manages the VERSIONS/payloads.
# Each present key adds a NEW version to its mapped secret (the app reads ':latest').
$ErrorActionPreference = "Stop"

$ProjectId = if ($env:PROJECT_ID) { $env:PROJECT_ID } else { "ozari-500103" }

$RepoRoot = Split-Path -Parent $PSScriptRoot
$EnvFile  = Join-Path $RepoRoot "secrets\staging.env"

if (-not (Test-Path $EnvFile)) {
    Write-Host "Secret file not found: $EnvFile"
    Write-Host "Create it (it is gitignored) using the KEY=VALUE format documented in this script."
    exit 1
}

# Map local env keys -> Secret Manager secret names.
$SecretMap = @{
    "DATABASE_URL"        = "ozari-database-url"
    "DIRECT_DATABASE_URL" = "ozari-direct-database-url"
    "JWT_SECRET"          = "ozari-jwt-secret"
    "JWT_REFRESH_SECRET"  = "ozari-jwt-refresh-secret"
    "ENCRYPTION_KEY"      = "ozari-encryption-key"
    "API_KEY"             = "ozari-api-key"
}

foreach ($line in Get-Content $EnvFile) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }

    $idx = $trimmed.IndexOf("=")
    if ($idx -lt 1) { continue }

    $key   = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim()

    if (-not $SecretMap.ContainsKey($key)) {
        Write-Host "Skipping unknown key: $key"
        continue
    }
    if ($value -eq "") {
        Write-Host "Skipping $key (empty value)."
        continue
    }

    $secret = $SecretMap[$key]
    Write-Host "Adding new version to secret '$secret' (from $key)..."

    # Pipe the value via stdin so it never appears in process args / shell history.
    $value | gcloud secrets versions add $secret --project=$ProjectId --data-file=-
    if ($LASTEXITCODE -ne 0) { throw "Failed to add version to $secret" }
}

Write-Host "Done. Verify with: gcloud secrets versions list <secret> --project=$ProjectId"
