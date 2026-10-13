# =============================================================================
# Ozari — open or close new-account registration on one environment.
#
#   ./infrastructure/scripts/registration.ps1 staging status    # what the live API runs with (read-only)
#   ./infrastructure/scripts/registration.ps1 staging close     # stop accepting new accounts
#   ./infrastructure/scripts/registration.ps1 staging open      # accept new accounts again
#
# THE LIVE SERVICE IS THE RECORD. Opening or closing sign-up is a business decision per environment,
# not a code change, so it lives in no file and needs no commit. This script is the ONLY thing that
# changes it; every other `tf.ps1 <env> gcp plan` reads the live value and keeps it (and the
# Terraform roots have no default for it), so no apply, deploy or rebuild can flip it by accident.
# A brand-new environment starts OPEN.
#
# The value reaches Cloud Run AND the Cloud Build trigger in the same apply (it is part of the
# computed runtime contract, modules/gcp-env/locals.tf), so later deploys keep it. The apply rolls a
# new revision; the switch is live when it finishes (about a minute).
#
# Accounts that already exist are never affected: closing stops NEW sign-ups only.
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("staging", "prod")]
    [string]$Environment,

    [Parameter(Mandatory = $true, Position = 1)][ValidateSet("open", "close", "status")]
    [string]$Action
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

function Write-Status {
    $live = Get-OzLiveRegistration $Environment
    if ($null -eq $live) {
        Write-Host "'$Environment' has no API service yet: its first gcp apply will start it OPEN." -ForegroundColor Cyan
    } elseif ($live -eq "true") {
        Write-Host "Registration on '$Environment' is OPEN." -ForegroundColor Yellow
    } elseif ($live -eq "false") {
        Write-Host "Registration on '$Environment' is CLOSED." -ForegroundColor Green
    } else {
        # The API fails closed on anything but "true"; the next gcp apply writes an explicit value.
        Write-Host "Registration on '$Environment' is CLOSED (REGISTRATION_OPEN not set yet)." -ForegroundColor Green
    }
}

if ($Action -eq "status") {
    Write-Status
    return
}

$open = $Action -eq "open"
try {
    $env:TF_VAR_registration_open = $(if ($open) { "true" } else { "false" })
    Write-Host ""
    Write-Host "Registration on '$Environment' -> $(if ($open) { 'OPEN' } else { 'CLOSED' })." -ForegroundColor Cyan
    Write-Host "Review the plan: it should change ONLY the Cloud Run service and the build trigger (REGISTRATION_OPEN)." -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot "tf.ps1") $Environment gcp plan
    & (Join-Path $PSScriptRoot "tf.ps1") $Environment gcp apply
} finally {
    Remove-Item Env:TF_VAR_registration_open -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Status
