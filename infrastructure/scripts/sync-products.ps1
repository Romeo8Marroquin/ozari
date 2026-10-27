# =============================================================================
# Ozari — MERGE the product catalog from one environment into another (pnpm sync:products).
#
#   ./infrastructure/scripts/sync-products.ps1 staging prod            # DRY RUN: what would be copied
#   ./infrastructure/scripts/sync-products.ps1 staging prod -Apply     # copy (asks to type 'prod')
#   ./infrastructure/scripts/sync-products.ps1 prod staging -Apply     # the other way round
#   ./infrastructure/scripts/sync-products.ps1 staging local           # rehearse into your local DB
#
# Copies every product the target does NOT already have (same name + same Alquiler/Venta, ignoring
# case, accents and punctuation) with its details and photos. Photos are downloaded from the source
# bucket and re-uploaded to the target's, so the target never points at the source's storage.
# Nothing in the target is ever modified or deleted, and the source is only read. Re-running is
# safe: what was copied is skipped. Full rules: the header of ozari-api/scripts/sync-products.ts.
#
# Credentials: each deployed side uses its OWN app login (database_url, DML only) and its own R2
# token from infrastructure/secrets/<env>.json; the R2 endpoint comes from account.json. `local`
# reads ozari-api/.env. Values go into THIS process's environment only and are removed afterwards.
#
# Both databases must already run this checkout's migrations (deploy first) — the script stops with
# a clear message otherwise.
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("local", "staging", "prod")]
    [string]$From,

    [Parameter(Mandatory = $true, Position = 1)][ValidateSet("local", "staging", "prod")]
    [string]$To,

    [switch]$Apply
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

if ($From -eq $To) { throw "Source and target are the same environment ('$From')." }

$apiDir = Join-Path (Get-OzRepoRoot) "ozari-api"
$sides = @("SOURCE", "TARGET")
$keys = @("LABEL", "DATABASE_URL", "R2_ENDPOINT", "R2_BUCKET", "R2_PUBLIC_URL", "R2_ACCESS_KEY", "R2_SECRET_KEY")

function Read-LocalEnv {
    # The few keys the merge needs from ozari-api/.env — parsed here, never printed.
    $path = Join-Path $apiDir ".env"
    if (-not (Test-Path $path)) { throw "ozari-api/.env not found (needed for 'local')." }
    $values = @{}
    foreach ($line in [IO.File]::ReadAllLines($path)) {
        if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') {
            $values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    $map = [ordered]@{
        LABEL         = "local"
        DATABASE_URL  = $values["DATABASE_URL"]
        R2_ENDPOINT   = $values["R2_ENDPOINT"]
        R2_BUCKET     = $values["R2_BUCKET_NAME"]
        R2_PUBLIC_URL = $values["R2_PUBLIC_URL"]
        R2_ACCESS_KEY = $values["R2_ACCESS_KEY"]
        R2_SECRET_KEY = $values["R2_SECRET_KEY"]
    }
    $missing = @($map.Keys | Where-Object { -not $map[$_] })
    if ($missing.Count -gt 0) { throw "ozari-api/.env lacks: $($missing -join ', ')." }
    return $map
}

function Read-DeployedEnv([string]$Name) {
    $secrets = Read-OzSecrets $Name
    $missing = @(Get-OzMissing $secrets $Name @("database_url", "r2_access_key", "r2_secret_key"))
    if ($missing.Count -gt 0) {
        throw "secrets/$Name.json is missing: $($missing -join ', '). Fill with ./infrastructure/scripts/secret.ps1 $Name <key>"
    }
    $account = Read-OzSecrets "account"
    $accountId = Get-OzValue $account "account" "cloudflare_account_id"
    if ($accountId -eq "") { throw "account.json lacks cloudflare_account_id. Run ./infrastructure/scripts/account.ps1" }
    $target = Get-OzTarget $Name
    return [ordered]@{
        LABEL         = $Name
        DATABASE_URL  = Get-OzValue $secrets $Name "database_url"
        R2_ENDPOINT   = "https://$accountId.r2.cloudflarestorage.com"
        R2_BUCKET     = $target.buckets[0]
        R2_PUBLIC_URL = "https://$($target.assets_host)"
        R2_ACCESS_KEY = Get-OzValue $secrets $Name "r2_access_key"
        R2_SECRET_KEY = Get-OzValue $secrets $Name "r2_secret_key"
    }
}

function Read-Side([string]$Name) {
    if ($Name -eq "local") { return Read-LocalEnv }
    return Read-DeployedEnv $Name
}

if ($Apply -and $To -eq "prod") {
    $confirm = Read-Host "This COPIES products into PRODUCTION ($From -> prod). Type 'prod' to continue"
    if ($confirm -ne "prod") { throw "Cancelled. Nothing was written." }
}

$values = @{ SOURCE = (Read-Side $From); TARGET = (Read-Side $To) }

Push-Location $apiDir
try {
    foreach ($side in $sides) {
        foreach ($key in $keys) { Set-Item -Path "Env:SYNC_${side}_$key" -Value $values[$side][$key] }
    }
    $mode = if ($Apply) { "APPLY" } else { "dry run" }
    Write-Host "Merging products $From -> $To ($mode) ..." -ForegroundColor Cyan
    if ($Apply) { pnpm sync:products --apply } else { pnpm sync:products }
    $code = $LASTEXITCODE
    if ($code -eq 1) {
        Write-Host "Dry run only. Review the plan above, then re-run with -Apply." -ForegroundColor Yellow
    } elseif ($code -ne 0) {
        throw "pnpm sync:products failed (exit $code) — see above."
    }
} finally {
    Pop-Location
    foreach ($side in $sides) {
        foreach ($key in $keys) { Remove-Item "Env:SYNC_${side}_$key" -ErrorAction SilentlyContinue }
    }
}
