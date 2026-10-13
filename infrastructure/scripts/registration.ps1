# =============================================================================
# Ozari — open or close new-account registration on one environment.
#
#   ./infrastructure/scripts/registration.ps1 staging status    # live value vs committed value (read-only)
#   ./infrastructure/scripts/registration.ps1 staging close     # stop accepting new accounts
#   ./infrastructure/scripts/registration.ps1 staging open      # accept new accounts again
#
# THE VALUE IS COMMITTED. Each environment's switch is `"registration_open"` in
# envs/<env>/environment.json — both environments start OPEN. tf.ps1 passes it to every gcp plan,
# and the Terraform roots have no default for it, so no apply can flip sign-up by omission: it
# changes only when this script changes the file. The script then plans + applies (you review and
# type the environment name as usual) and reminds you to COMMIT the file — an uncommitted change is
# undone by the next apply made from a clean checkout.
#
# If the plan or the apply does not complete, the file is put back, so file and live service never
# disagree because of a half-run.
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

$envConfig = Get-OzEnvironment $Environment
$envFile = Join-Path (Get-OzInfraRoot) "terraform\envs\$Environment\environment.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-LiveValue {
    # What the serving revision actually runs with — read from Cloud Run, not from a file.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $json = & gcloud run services describe ozari-api --region=$($envConfig.region) --project=$($envConfig.project_id) --format=json 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $json) { return $null }
        $vars = @(($json | Out-String | ConvertFrom-Json).spec.template.spec.containers[0].env)
        $entry = $vars | Where-Object { $_.name -eq "REGISTRATION_OPEN" } | Select-Object -First 1
        if ($entry) { return [string]$entry.value }
        return ""
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Get-CommittedValue {
    $prop = (Get-OzEnvironment $Environment).PSObject.Properties["registration_open"]
    if (-not $prop -or $prop.Value -isnot [bool]) { throw "$envFile has no boolean `"registration_open`"." }
    return [bool]$prop.Value
}

function Write-Status {
    $live = Get-LiveValue
    $committed = Get-CommittedValue
    $word = { param($b) if ($b) { "OPEN" } else { "CLOSED" } }
    if ($null -eq $live) {
        Write-Warning "Could not read the Cloud Run service in $($envConfig.project_id) (gcloud auth login?)."
    } else {
        # The API opens ONLY on the exact string "true"; anything else (absent included) is closed.
        $liveOpen = $live -eq "true"
        $color = if ($liveOpen) { "Yellow" } else { "Green" }
        Write-Host "Registration on '$Environment' is $(& $word $liveOpen) (live service)." -ForegroundColor $color
        if ($liveOpen -ne $committed) {
            Write-Warning "environment.json says $(& $word $committed). Run: registration.ps1 $Environment $(if ($committed) { 'open' } else { 'close' }) — or the next gcp apply will make it so."
        }
    }
    Write-Host "Committed value (envs/$Environment/environment.json): $(& $word $committed)"
}

if ($Action -eq "status") {
    Write-Status
    return
}

$wantOpen = $Action -eq "open"
$original = [IO.File]::ReadAllText($envFile, $utf8NoBom)
if ($original -notmatch '"registration_open":\s*(true|false)') {
    throw "$envFile has no `"registration_open`": true|false line to change."
}
$updated = $original -replace '"registration_open":\s*(true|false)', "`"registration_open`": $(if ($wantOpen) { 'true' } else { 'false' })"

$applied = $false
try {
    if ($updated -ne $original) { [IO.File]::WriteAllText($envFile, $updated, $utf8NoBom) }
    Write-Host ""
    Write-Host "Registration on '$Environment' -> $(if ($wantOpen) { 'OPEN' } else { 'CLOSED' })." -ForegroundColor Cyan
    Write-Host "Review the plan: it should change ONLY the Cloud Run service and the build trigger (REGISTRATION_OPEN)." -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot "tf.ps1") $Environment gcp plan
    & (Join-Path $PSScriptRoot "tf.ps1") $Environment gcp apply
    $applied = $true
} finally {
    if (-not $applied -and $updated -ne $original) {
        [IO.File]::WriteAllText($envFile, $original, $utf8NoBom)
        Write-Host "Not applied — envs/$Environment/environment.json is back to what it was." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Status
if ($updated -ne $original) {
    Write-Host ""
    Write-Host "COMMIT envs/$Environment/environment.json now — it is the record of this switch:" -ForegroundColor Yellow
    Write-Host "  git add infrastructure/terraform/envs/$Environment/environment.json" -ForegroundColor Yellow
    Write-Host "  git commit -m `"$Environment`: registration $(if ($wantOpen) { 'opened' } else { 'closed' })`"" -ForegroundColor Yellow
}
