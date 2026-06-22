# Idempotent creation of the Terraform remote-state bucket (PowerShell).
# The bucket already exists in this project; this script is safe to re-run and will
# simply skip creation and ensure versioning is on.
$ErrorActionPreference = "Stop"

$ProjectId = if ($env:PROJECT_ID) { $env:PROJECT_ID } else { "ozari-500103" }
$Region    = if ($env:REGION) { $env:REGION } else { "northamerica-south1" }
$Bucket    = "gs://ozari-500103-tfstate"

Write-Host "Project : $ProjectId"
Write-Host "Region  : $Region"
Write-Host "Bucket  : $Bucket"

# `gcloud storage buckets describe` exits non-zero if the bucket does not exist.
gcloud storage buckets describe $Bucket 1>$null 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Bucket $Bucket already exists. Skipping creation."
} else {
    Write-Host "Creating bucket $Bucket..."
    gcloud storage buckets create $Bucket `
        --project=$ProjectId `
        --location=$Region `
        --uniform-bucket-level-access `
        --public-access-prevention
}

Write-Host "Ensuring object versioning is enabled (protects state history)..."
gcloud storage buckets update $Bucket --versioning

Write-Host "Done."
