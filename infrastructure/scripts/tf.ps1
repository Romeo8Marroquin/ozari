# =============================================================================
# Ozari — the ONE way to run Terraform here, for every environment and stack.
#
#   ./infrastructure/scripts/tf.ps1 staging bootstrap plan
#   ./infrastructure/scripts/tf.ps1 staging bootstrap apply
#   ./infrastructure/scripts/tf.ps1 staging cloudflare plan | apply
#   ./infrastructure/scripts/tf.ps1 staging gcp        plan | apply
#   ./infrastructure/scripts/tf.ps1 prod    gcp        output
#   ./infrastructure/scripts/tf.ps1 staging gcp        validate     # no credentials needed
#
# PLAN, THEN APPLY THE PLAN. `plan` saves the plan to a file; `apply` applies exactly that file and
# nothing else — what you reviewed is byte-for-byte what happens. A plan made stale by any change in
# between is rejected by Terraform itself. There is no `destroy` verb: retiring an environment is a
# documented procedure (REBUILD.md), not a flag on a convenience script.
#
# What it supplies, so no root needs a hand-written tfvars file:
#   · backend bucket, project_id, project_name, region, state_bucket  ← envs/<env>/environment.json
#   · registration_open (gcp only)        ← the LIVE service's value (registration.ps1 changes it)
#   · account values (TF_VAR_*), CLOUDFLARE_API_TOKEN                   ← secrets/account.json
#   · TF_VAR_secret_values / _secret_version_triggers (gcp only)        ← secrets/<env>.json
# All as variables of THIS process only, removed again on exit.
#
# BOOTSTRAP'S FIRST RUN has no state bucket yet (it is what the run creates). The wrapper then plans
# and applies with a temporary local backend and, once the bucket exists, migrates the state into
# it and deletes the local copy. Every later run uses the bucket.
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("staging", "prod")]
    [string]$Environment,

    [Parameter(Mandatory = $true, Position = 1)][ValidateSet("bootstrap", "gcp", "cloudflare")]
    [string]$Stack,

    [Parameter(Mandatory = $true, Position = 2)][ValidateSet("init", "validate", "plan", "apply", "output")]
    [string]$Action,

    # Skip the typed confirmation before applying a SAVED plan you have already reviewed.
    [switch]$Yes,

    # Passed straight to `terraform plan`, e.g. -Extra "-target=module.cloudflare.cloudflare_r2_bucket.assets"
    [string[]]$Extra = @()
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

$InfraRoot = Get-OzInfraRoot
$Dir = Join-Path $InfraRoot "terraform\envs\$Environment\$Stack"
if (-not (Test-Path $Dir)) { throw "No such Terraform root: $Dir" }

$envConfig = Get-OzEnvironment $Environment
$PlanFile = Join-Path $Dir ".terraform\ozari.tfplan"
$LocalState = Join-Path $Dir "terraform.tfstate"
$LocalOverride = Join-Path $Dir "local_backend_override.tf"   # gitignored (*_override.tf)

# --- Terraform version -------------------------------------------------------
if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) { throw "terraform is not on PATH (winget install Hashicorp.Terraform)." }
$tfVersion = [version]((terraform version -json | ConvertFrom-Json).terraform_version)
if ($tfVersion -lt [version]"1.11.0") {
    throw "Terraform $tfVersion found; >= 1.11 is required for write-only secret arguments (secret_data_wo)."
}

function Invoke-Tf {
    param([string[]]$Arguments)
    & terraform @Arguments
    if ($LASTEXITCODE -ne 0) { throw "terraform $($Arguments[0]) failed (exit $LASTEXITCODE)." }
}

function Test-StateBucket {
    # Windows PowerShell turns a native command's redirected stderr into error records, which
    # $ErrorActionPreference = Stop would throw on — so this one probe runs with Continue.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & gcloud storage buckets describe "gs://$($envConfig.state_bucket)" --format="value(name)" 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    } finally {
        $ErrorActionPreference = $previous
    }
}

Push-Location $Dir
try {
    Write-Host "→ $Environment / $Stack   ($Dir)" -ForegroundColor Cyan

    # --- validate: syntax + schema only; no backend, no credentials ------------------
    if ($Action -eq "validate") {
        Invoke-Tf @("init", "-backend=false", "-input=false")
        Invoke-Tf @("validate")
        return
    }

    # --- Inputs ---------------------------------------------------------------------
    $env:TF_VAR_project_id = $envConfig.project_id
    $env:TF_VAR_project_name = $envConfig.project_name
    $env:TF_VAR_region = $envConfig.region
    $env:TF_VAR_state_bucket = $envConfig.state_bucket

    $require = switch ($Stack) {
        "bootstrap" { @("billing_account") }
        "gcp" { @("github_app_installation_id", "cloudflare_account_id") }
        "cloudflare" { @("cloudflare_account_id", "cloudflare_zone_id", "cloudflare_api_token") }
    }
    Import-OzAccount -Require $require | Out-Null

    if ($Stack -eq "gcp" -and $Action -ne "output") {
        # The registration switch: registration.ps1 sets TF_VAR_registration_open explicitly; every
        # other plan KEEPS whatever the live service runs with, so no apply can reopen or close
        # sign-up by accident. A brand-new environment (no service yet) starts OPEN.
        if (-not $env:TF_VAR_registration_open) {
            $live = Get-OzLiveRegistration $Environment
            $env:TF_VAR_registration_open = $(if ($live -eq "false") { "false" } else { "true" })
            $shown = $(if ($null -eq $live) { "new environment -> OPEN" } elseif ($live -eq "false") { "CLOSED" } else { "OPEN" })
            Write-Host "Registration: keeping the live value ($shown). Change it only with registration.ps1." -ForegroundColor DarkGray
        }

        $secrets = Read-OzSecrets $Environment
        $missing = @(Get-OzMissing $secrets $Environment)
        if ($missing.Count -gt 0) {
            throw @"
secrets/$Environment.json still has EMPTY values: $($missing -join ', ')
An empty Secret Manager version is a container that dies at startup with an error that points at
nothing, so the plan stops here instead. Fill them (REBUILD.md §3 says where each comes from):
  ./infrastructure/scripts/secret.ps1 $Environment <key>
"@
        }
        $env:TF_VAR_secret_values = $secrets.secrets | ConvertTo-Json -Compress -Depth 3
        $env:TF_VAR_secret_version_triggers = $secrets.rotation | ConvertTo-Json -Compress -Depth 3
    }

    # --- Backend --------------------------------------------------------------------
    # Bootstrap runs locally until its bucket exists (or while a local state is still waiting to be
    # migrated after an interrupted first run).
    $localMode = $false
    if ($Stack -eq "bootstrap") {
        $localMode = (Test-Path $LocalState) -or -not (Test-StateBucket)
    } elseif (-not (Test-StateBucket)) {
        throw "State bucket gs://$($envConfig.state_bucket) does not exist (or you cannot read it). Run: tf.ps1 $Environment bootstrap apply"
    }

    if ($localMode) {
        Write-Host "First bootstrap run: state is LOCAL until the bucket exists, then it is migrated into it." -ForegroundColor Yellow
        Set-Content -Path $LocalOverride -Encoding ascii -Value 'terraform {
  backend "local" {
    path = "terraform.tfstate"
  }
}'
        Invoke-Tf @("init", "-input=false", "-reconfigure")
    } else {
        Invoke-Tf @("init", "-input=false", "-reconfigure", "-backend-config=bucket=$($envConfig.state_bucket)")
    }

    switch ($Action) {
        "init" { }

        "output" { Invoke-Tf @("output") }

        "plan" {
            Invoke-Tf @("validate")
            Invoke-Tf (@("plan", "-input=false", "-out=$PlanFile") + $Extra)
            Write-Host ""
            Write-Host "Plan saved. Review it above, then:  ./infrastructure/scripts/tf.ps1 $Environment $Stack apply" -ForegroundColor Cyan
        }

        "apply" {
            if (-not (Test-Path $PlanFile)) {
                throw "No saved plan. Run 'tf.ps1 $Environment $Stack plan' first, review it, then apply."
            }
            if (-not $Yes) {
                Write-Host ""
                Write-Host "About to APPLY the saved plan to $Environment / $Stack." -ForegroundColor Yellow
                if ($Environment -eq "prod") { Write-Host "This is PRODUCTION." -ForegroundColor Red }
                $confirm = Read-Host "Type the environment name ($Environment) to continue"
                if ($confirm -ne $Environment) { throw "Confirmation did not match. Nothing was applied." }
            }
            try {
                Invoke-Tf @("apply", "-input=false", $PlanFile)
            } finally {
                # A saved plan is single-use either way: applied, or stale after a partial apply.
                Remove-Item $PlanFile -ErrorAction SilentlyContinue
            }

            if ($localMode -and (Test-StateBucket)) {
                Write-Host ""
                Write-Host "Migrating bootstrap state into gs://$($envConfig.state_bucket) ..." -ForegroundColor Cyan
                Remove-Item $LocalOverride -ErrorAction SilentlyContinue
                Invoke-Tf @("init", "-input=false", "-migrate-state", "-force-copy", "-backend-config=bucket=$($envConfig.state_bucket)")
                Remove-Item $LocalState, "$LocalState.backup" -ErrorAction SilentlyContinue
                $localMode = $false
                Write-Host "Bootstrap state now lives in the bucket; the local copy is gone." -ForegroundColor Green
            }
        }
    }
} finally {
    if ($localMode) { Remove-Item $LocalOverride -ErrorAction SilentlyContinue }
    Pop-Location
    Clear-OzProcessSecrets
    foreach ($n in @("TF_VAR_project_id", "TF_VAR_project_name", "TF_VAR_region", "TF_VAR_state_bucket", "TF_VAR_registration_open")) {
        Remove-Item "Env:$n" -ErrorAction SilentlyContinue
    }
}
