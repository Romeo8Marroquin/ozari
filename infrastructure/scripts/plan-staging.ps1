# Init + validate + plan for the staging environment.
# Read-only: this NEVER applies. Review the plan output (including any imports/adoptions).
$ErrorActionPreference = "Stop"

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$StagingDir = Join-Path $RepoRoot "terraform\envs\staging"

Write-Host "==> Working dir: $StagingDir"
Push-Location $StagingDir
try {
    terraform init
    if ($LASTEXITCODE -ne 0) { throw "terraform init failed" }

    terraform validate
    if ($LASTEXITCODE -ne 0) { throw "terraform validate failed" }

    terraform plan
    if ($LASTEXITCODE -ne 0) { throw "terraform plan failed" }
}
finally {
    Pop-Location
}
