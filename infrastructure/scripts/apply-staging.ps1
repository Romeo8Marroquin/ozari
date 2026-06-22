# Apply for the staging environment. Requires EXPLICIT human confirmation.
# Run plan-staging.ps1 first and review the output before using this.
$ErrorActionPreference = "Stop"

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$StagingDir = Join-Path $RepoRoot "terraform\envs\staging"

Write-Host "==> Working dir: $StagingDir"
Write-Host ""
Write-Host "WARNING: This will run 'terraform apply' against STAGING (project ozari-500103)."
Write-Host "It can adopt and MODIFY existing Cloud Run, Artifact Registry, secrets, IAM, and the build trigger."
Write-Host ""

$confirm = Read-Host "Type exactly 'apply staging' to proceed"
if ($confirm -ne "apply staging") {
    Write-Host "Aborted. Nothing was applied."
    exit 1
}

Push-Location $StagingDir
try {
    terraform init
    if ($LASTEXITCODE -ne 0) { throw "terraform init failed" }

    terraform apply
    if ($LASTEXITCODE -ne 0) { throw "terraform apply failed" }
}
finally {
    Pop-Location
}
