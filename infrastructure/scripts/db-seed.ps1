# =============================================================================
# Ozari — load reference data into an environment's database (`pnpm db:seed`), as the MIGRATOR.
#
#   ./infrastructure/scripts/db-seed.ps1 staging
#   ./infrastructure/scripts/db-seed.ps1 staging -Force     # db:seed:force — restores seeded defaults
#
# Run ONCE per fresh database, after the first deploy has applied the migrations. It is idempotent
# (upsert by id), so a second run is harmless.
#
# Why the MIGRATOR (direct_database_url) and not the app role: the seed resets serial sequences with
# setval(), which needs UPDATE on the sequence — a right of the sequence's owner. The app role holds
# USAGE+SELECT only, by design, so the running API can never rewrite a primary-key counter. As the app
# role the seed would fail partway, having already inserted rows.
#
# Afterwards it takes back the app role's access to `_prisma_migrations`: the first deploy created
# that table, and the migrator's default privileges granted the app DML on it like on any other table.
#
# The connection string goes into this process's DATABASE_URL only. dotenv never overrides a
# variable that is already set, so a local ozari-api/.env cannot redirect the seed elsewhere.
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("staging", "prod")]
    [string]$Environment,

    [switch]$Force
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

$data = Read-OzSecrets $Environment
$migratorUrl = Get-OzValue $data $Environment "direct_database_url"
if ($migratorUrl -eq "") { throw "direct_database_url is empty for '$Environment'. Run ./infrastructure/scripts/neon.ps1 $Environment first." }

if ($Environment -eq "prod" -and $Force) {
    $confirm = Read-Host "db:seed:force on PRODUCTION resets seeded preferences/lifecycle to defaults. Type 'prod' to continue"
    if ($confirm -ne "prod") { throw "Cancelled." }
}

$apiDir = Join-Path (Get-OzRepoRoot) "ozari-api"
$previousNodeEnv = $env:NODE_ENV
Push-Location $apiDir
try {
    $env:DATABASE_URL = $migratorUrl
    # Not "development": that switches Prisma query logging on, and this run is against a deployed DB.
    $env:NODE_ENV = if ($Environment -eq "prod") { "production" } else { "staging" }
    $script = if ($Force) { "db:seed:force" } else { "db:seed" }
    Write-Host "Running pnpm $script against '$Environment' as the migrator ..." -ForegroundColor Cyan
    pnpm $script
    if ($LASTEXITCODE -ne 0) { throw "pnpm $script failed (exit $LASTEXITCODE)." }
    Write-Host "Seed complete for '$Environment'." -ForegroundColor Green

    $env:OZ_TIGHTEN_URL = $migratorUrl
    & node (Join-Path $PSScriptRoot "db-bootstrap.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Could not revoke the app role's access to _prisma_migrations (see above)." }
} finally {
    Pop-Location
    Remove-Item Env:DATABASE_URL, Env:OZ_TIGHTEN_URL -ErrorAction SilentlyContinue
    if ($null -ne $previousNodeEnv) { $env:NODE_ENV = $previousNodeEnv } else { Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue }
}
