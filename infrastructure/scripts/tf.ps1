# =============================================================================
# Ozari — Terraform wrapper. One script for every environment and stack.
#
#   ./tf.ps1 staging gcp plan
#   ./tf.ps1 staging gcp apply
#   ./tf.ps1 staging cloudflare plan
#   ./tf.ps1 prod    gcp apply
#   ./tf.ps1 bootstrap - apply           # the one-time project/state-bucket root
#
# There is no `destroy` verb, on purpose. Destroying an environment is a deliberate, documented
# procedure (INFRASTRUCTURE-PLAN.md §6), not a flag on a convenience script.
#
# What it does beyond running terraform:
#   · checks the Terraform version, because `secret_data_wo` needs >= 1.11 and the failure without
#     it is an unhelpful parse error;
#   · checks the environment's secrets file exists before a gcp apply, so you find out now rather
#     than after Terraform has already created half the resources;
#   · refuses to run a cloudflare stack without CLOUDFLARE_API_TOKEN set;
#   · requires you to type the environment name before an apply.
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet("staging", "prod", "bootstrap")]
    [string]$Environment,

    [Parameter(Mandatory = $true)][ValidateSet("gcp", "cloudflare", "-")]
    [string]$Stack,

    [Parameter(Mandatory = $true)][ValidateSet("init", "validate", "plan", "apply", "output")]
    [string]$Action,

    # Extra arguments passed straight through, e.g. -Extra "-target=module.gcp.google_secret_manager_secret.this"
    [string[]]$Extra = @()
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ($Environment -eq "bootstrap") {
    $Dir = Join-Path $RepoRoot "infrastructure\terraform\bootstrap"
} else {
    if ($Stack -eq "-") { throw "A stack (gcp | cloudflare) is required for the '$Environment' environment." }
    $Dir = Join-Path $RepoRoot "infrastructure\terraform\envs\$Environment\$Stack"
}

if (-not (Test-Path $Dir)) { throw "No such Terraform root: $Dir" }

# --- Terraform version -------------------------------------------------------
$tf = Get-Command terraform -ErrorAction SilentlyContinue
if (-not $tf) { throw "terraform is not on PATH." }

$versionJson = terraform -version -json | ConvertFrom-Json
$version = [version]($versionJson.terraform_version)
if ($version -lt [version]"1.11.0") {
    throw "Terraform $version found; >= 1.11.0 is required. Write-only secret arguments (secret_data_wo) do not exist before 1.11, and the error without them points at the argument rather than at the version."
}

# --- Preflight ---------------------------------------------------------------
if ($Stack -eq "cloudflare" -and -not $env:CLOUDFLARE_API_TOKEN) {
    throw @"
CLOUDFLARE_API_TOKEN is not set.

  `$env:CLOUDFLARE_API_TOKEN = "<token>"

It is an environment variable and never a tfvars value: a token passed as a provider argument is
written into Terraform state. Required scopes are listed in the stack's terraform.tfvars.example.
"@
}

if ($Stack -eq "gcp" -and $Action -eq "apply") {
    $secretsFile = Join-Path $Dir "secrets.auto.tfvars"
    if (-not (Test-Path $secretsFile)) {
        throw @"
$secretsFile is missing.

Copy secrets.auto.tfvars.example next to it and fill in every key. Terraform owns the Secret Manager
VERSIONS now, so an apply without this file fails partway through naming a missing map key.
"@
    }
}

Push-Location $Dir
try {
    Write-Host "→ $Environment/$Stack  ($Dir)"
    Write-Host ""

    if ($Action -ne "output") {
        terraform init -input=false
        if ($LASTEXITCODE -ne 0) { throw "terraform init failed." }
    }

    switch ($Action) {
        "init" { }
        "validate" {
            terraform validate
        }
        "plan" {
            terraform validate
            if ($LASTEXITCODE -ne 0) { throw "terraform validate failed." }
            terraform plan -input=false @Extra
        }
        "apply" {
            Write-Host ""
            Write-Host "About to APPLY to '$Environment/$Stack'." -ForegroundColor Yellow
            if ($Environment -eq "prod") {
                Write-Host "This is PRODUCTION." -ForegroundColor Red
            }
            $confirm = Read-Host "Type the environment name to continue"
            if ($confirm -ne $Environment) { throw "Confirmation did not match. Nothing was applied." }
            terraform apply -input=false @Extra
        }
        "output" {
            terraform output
        }
    }

    if ($LASTEXITCODE -ne 0) { throw "terraform $Action failed (exit $LASTEXITCODE)." }
} finally {
    Pop-Location
}
