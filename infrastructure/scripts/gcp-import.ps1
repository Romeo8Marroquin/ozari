# =============================================================================
# Ozari — generate Terraform import blocks for an EXISTING Google Cloud environment.
#
#   ./gcp-import.ps1 -Environment staging
#
# WHY THIS EXISTS. Staging is live and working. The Terraform rework declares resources that already
# exist out there, and Terraform assumes anything in config that is not in state must be CREATED.
# For most of staging that is already handled by `moved.tf` (the old flat resource addresses move
# into the module, which is bookkeeping and touches no API). This script covers what `moved.tf`
# cannot: objects that were never in Terraform state at all.
#
# ⚠️ THE ONE THAT MATTERS: SECRET VERSIONS.
#
# Terraform now owns the secret payloads, but staging's eleven versions were created by hand. Without
# importing them the first apply CREATES a new version of every secret from whatever is in
# secrets.auto.tfvars — and if any of those values does not exactly match what is live (mistyped, or
# reconstructed from memory because nobody kept a copy), the apply silently rotates that secret to
# the wrong value. Staging then dies at the next cold start with a credential error that points at
# nothing. Importing first makes the whole thing inert: with the version in state and no rotation
# counter set, a wrong value in the file does nothing at all.
#
# Read-only against Google: `gcloud secrets versions list` and friends. Writes one local file.
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet("staging", "prod")]
    [string]$Environment,

    [string]$ProjectId = "",

    # Print what would be imported without writing the file.
    [switch]$InventoryOnly
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$EnvDir = Join-Path $RepoRoot "infrastructure\terraform\envs\$Environment\gcp"
if (-not (Test-Path $EnvDir)) { throw "No such environment directory: $EnvDir" }

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "gcloud is not on PATH."
}

# --- Resolve the project ----------------------------------------------------
function Get-TfVar {
    param([string]$Name, [string]$File)
    if (-not (Test-Path $File)) { return "" }
    $line = Select-String -Path $File -Pattern "^\s*$Name\s*=\s*`"([^`"]*)`"" | Select-Object -First 1
    if ($line) { return $line.Matches[0].Groups[1].Value }
    return ""
}

if (-not $ProjectId) { $ProjectId = Get-TfVar "project_id" (Join-Path $EnvDir "terraform.tfvars") }
if (-not $ProjectId -and $Environment -eq "staging") { $ProjectId = "ozari-500103" }
if (-not $ProjectId) { throw "project_id not found. Fill $EnvDir\terraform.tfvars or pass -ProjectId." }

# The registry, mirrored from modules/gcp-env/secrets.tf. Kept in the same ORDER and with the same
# keys; if a secret is added there and not here, this script simply will not import it and the first
# apply creates its version — which for a NEW secret is exactly right.
$secretMap = [ordered]@{
    database_url         = "ozari-database-url"
    direct_database_url  = "ozari-direct-database-url"
    jwt_secret           = "ozari-jwt-secret"
    jwt_refresh_secret   = "ozari-jwt-refresh-secret"
    encryption_key       = "ozari-encryption-key"
    api_key              = "ozari-api-key"
    email_key            = "ozari-email-key"
    r2_access_key        = "ozari-r2-access-key"
    r2_secret_key        = "ozari-r2-secret-key"
    google_client_id     = "ozari-google-client-id"
    google_client_secret = "ozari-google-client-secret"
}

$imports = [ordered]@{}
$report = @()

Write-Host ""
Write-Host "Inventorying project '$ProjectId' ..." -ForegroundColor Cyan
Write-Host ""

# --- Secret versions --------------------------------------------------------
foreach ($key in $secretMap.Keys) {
    $secret = $secretMap[$key]

    # The newest ENABLED version. `:latest` is what Cloud Run binds, so this is the version whose
    # value the running service is actually using.
    $version = & gcloud secrets versions list $secret `
        --project=$ProjectId `
        --filter="state=ENABLED" `
        --sort-by="~createTime" `
        --limit=1 `
        --format="value(name)" 2>$null

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($version)) {
        $report += [pscustomobject]@{ Kind = "secret-version"; Name = $secret; Status = "absent — will be CREATED" }
        continue
    }

    $version = $version.Trim()
    $addr = "module.gcp.google_secret_manager_secret_version.this[`"$key`"]"
    $imports[$addr] = "projects/$ProjectId/secrets/$secret/versions/$version"
    $report += [pscustomobject]@{ Kind = "secret-version"; Name = "$secret v$version"; Status = "import" }
}

# --- The build SA's right to act as the runtime SA --------------------------
# Granted out-of-band before Terraform declared it. It is an ADDITIVE member, so re-creating it is a
# harmless no-op re-assertion — importing is tidiness rather than necessity, but a clean plan is
# easier to read than one with a "create" line you have to remember is safe.
$runSa = "ozari-run-sa@$ProjectId.iam.gserviceaccount.com"
$buildSa = "ozari-build-sa@$ProjectId.iam.gserviceaccount.com"

$binding = & gcloud iam service-accounts get-iam-policy $runSa `
    --project=$ProjectId `
    --format="value(bindings.members)" `
    --filter="bindings.role=roles/iam.serviceAccountUser" 2>$null

if ($LASTEXITCODE -eq 0 -and $binding -match [regex]::Escape($buildSa)) {
    $addr = "module.gcp.google_service_account_iam_member.build_sa_acts_as_run_sa"
    $imports[$addr] = "projects/$ProjectId/serviceAccounts/$runSa roles/iam.serviceAccountUser serviceAccount:$buildSa"
    $report += [pscustomobject]@{ Kind = "sa-iam"; Name = "build-sa actsAs run-sa"; Status = "import" }
} else {
    $report += [pscustomobject]@{ Kind = "sa-iam"; Name = "build-sa actsAs run-sa"; Status = "absent — will be CREATED" }
}

# --- Report -----------------------------------------------------------------
$report | Format-Table Kind, Name, Status -AutoSize | Out-String | Write-Host

$created = @($report | Where-Object { $_.Status -ne "import" })
if ($created.Count -gt 0) {
    Write-Host "$($created.Count) object(s) do not exist yet and will be created by the apply." -ForegroundColor Yellow
    Write-Host "For a secret version that means the value in secrets.auto.tfvars becomes the live value." -ForegroundColor Yellow
    Write-Host ""
}

if ($InventoryOnly) { return }

# --- Emit -------------------------------------------------------------------
$outFile = Join-Path $EnvDir "imports.generated.tf"
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("# GENERATED by infrastructure/scripts/gcp-import.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm').")
[void]$sb.AppendLine("# Environment: $Environment / project $ProjectId.  DO NOT EDIT — re-run the script.")
[void]$sb.AppendLine("#")
[void]$sb.AppendLine("# Adopts objects that exist in Google Cloud but were never in Terraform state. The old flat")
[void]$sb.AppendLine("# resources are handled separately by moved.tf, which is pure bookkeeping and calls no API.")
[void]$sb.AppendLine("#")
[void]$sb.AppendLine("# After applying these, secret_version_triggers must stay EMPTY for the adopted keys: an")
[void]$sb.AppendLine("# imported version has no trigger in state, so adding one is a request to rotate.")
[void]$sb.AppendLine("")

if ($imports.Count -eq 0) {
    [void]$sb.AppendLine("# Nothing found to import — this environment does not exist yet in Google Cloud.")
    [void]$sb.AppendLine("# Expected for a from-scratch build; delete this file and apply.")
} else {
    foreach ($addr in $imports.Keys) {
        [void]$sb.AppendLine("import {")
        [void]$sb.AppendLine("  to = $addr")
        [void]$sb.AppendLine("  id = `"$($imports[$addr])`"")
        [void]$sb.AppendLine("}")
        [void]$sb.AppendLine("")
    }
}

$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($outFile, $sb.ToString(), $utf8Bom)

Write-Host "Wrote $($imports.Count) import block(s) to:" -ForegroundColor Green
Write-Host "  $outFile"
Write-Host ""
Write-Host "Next:"
Write-Host "  ./scripts/tf.ps1 $Environment gcp plan"
Write-Host ""
Write-Host "A correct adoption plan shows: imports, the moves from moved.tf, and in-place updates"
Write-Host "(registry cleanup policies, labels, trigger substitutions). It must show NO destroy of the"
Write-Host "Cloud Run service, the registry, a service account or a secret — and no NEW secret version."
Write-Host ""
