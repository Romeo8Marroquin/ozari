# =============================================================================
# Ozari — when does each EXPIRING credential expire? READ-ONLY.
#
#   ./infrastructure/scripts/expiry.ps1
#   ./infrastructure/scripts/expiry.ps1 -WarnDays 60
#
# Asks the providers themselves, so the answer is never a date someone wrote down and forgot:
#   Cloudflare  ozari-terraform-local (account.json)   GET /user/tokens/verify  → expires_on
#   GitHub      the classic PAT of each environment    GET /user                → token-expiration header
#
# Every other key in the credential register (REBUILD.md §3) has NO expiry by design. How to renew
# each of these: REBUILD.md §3 "Expiring keys — renewal". GET requests only; nothing is changed.
# =============================================================================
[CmdletBinding()]
param(
    # Below this many days left, a key is reported as RENEW SOON.
    [int]$WarnDays = 45
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

$rows = New-Object System.Collections.ArrayList
function Add-Row([string]$Name, [string]$Stored, $Date, [string]$State) {
    [void]$rows.Add([pscustomobject]@{ Key = $Name; Stored = $Stored; Expires = $Date; State = $State })
}

# Both providers print the day first (ISO "2027-10-13T…" / "2027-10-13 12:00:00 -0600"); day
# precision is all a renewal needs, and it avoids parsing two offset formats under a non-US locale.
function Get-Day([string]$Text) {
    if ($Text -match '^(\d{4}-\d{2}-\d{2})') {
        return [datetime]::ParseExact($Matches[1], "yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
    }
    return $null
}

function Get-State($Day) {
    if ($null -eq $Day) { return "no expiry set" }
    $left = [int][math]::Floor(($Day - (Get-Date).Date).TotalDays)
    if ($left -lt 0) { return "EXPIRED $(-$left) day(s) ago" }
    if ($left -le $WarnDays) { return "RENEW SOON — $left day(s) left" }
    return "ok — $left day(s) left"
}

# --- Cloudflare: the operator's Terraform token (shared by both environments) ------------------
$acct = Read-OzSecrets "account"
$cf = Get-OzValue $acct "account" "cloudflare_api_token"
$cfName = "Cloudflare ozari-terraform-local"
if ($cf -eq "") {
    Add-Row $cfName "account.json" "" "not stored"
} else {
    try {
        $r = Invoke-RestMethod -Method Get -Uri "https://api.cloudflare.com/client/v4/user/tokens/verify" `
            -Headers @{ Authorization = "Bearer $cf" } -TimeoutSec 30
        $exp = $null
        if ($r.result.PSObject.Properties["expires_on"] -and $r.result.expires_on) { $exp = Get-Day ([string]$r.result.expires_on) }
        $state = if ($r.result.status -ne "active") { "NOT ACTIVE ($($r.result.status))" } else { Get-State $exp }
        Add-Row $cfName "account.json" $(if ($exp) { $exp.ToString("yyyy-MM-dd") } else { "" }) $state
    } catch {
        Add-Row $cfName "account.json" "" "REJECTED — expired or revoked: renew it now"
    }
}
$cf = $null

# --- GitHub: the classic PAT Cloud Build uses, one per environment -------------------------------
foreach ($envName in @("staging", "prod")) {
    $name = "GitHub ozari cloud-build $envName"
    # Read-OzSecrets would CREATE a missing file from the template — a report must not do that.
    if (-not (Test-Path (Get-OzSecretsPath $envName))) { Add-Row $name "$envName.json" "" "no $envName.json"; continue }
    $pat = Get-OzValue (Read-OzSecrets $envName) $envName "github_oauth_token"
    if ($pat -eq "") { Add-Row $name "$envName.json" "" "not stored"; continue }
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -Method Get -Uri "https://api.github.com/user" -TimeoutSec 30 `
            -Headers @{ Authorization = "token $pat"; "User-Agent" = "ozari-expiry"; Accept = "application/vnd.github+json" }
        $header = $resp.Headers.Keys | Where-Object { $_ -ieq "GitHub-Authentication-Token-Expiration" } | Select-Object -First 1
        $exp = if ($header) { Get-Day ([string]$resp.Headers[$header]) } else { $null }
        Add-Row $name "$envName.json" $(if ($exp) { $exp.ToString("yyyy-MM-dd") } else { "" }) (Get-State $exp)
    } catch {
        Add-Row $name "$envName.json" "" "REJECTED — expired or revoked: deploys of $envName are stopped, renew it now"
    }
    $pat = $null
}

Write-Host ""
Write-Host "Expiring credentials (today $((Get-Date).ToString('yyyy-MM-dd')), warning at $WarnDays days)" -ForegroundColor Cyan
foreach ($row in $rows) {
    $color = if ($row.State -like "ok*") { "Green" } elseif ($row.State -like "RENEW*" -or $row.State -eq "no expiry set") { "Yellow" } else { "Red" }
    Write-Host ("  {0,-36} {1,-14} {2,-11} {3}" -f $row.Key, $row.Stored, $row.Expires, $row.State) -ForegroundColor $color
}
Write-Host ""
Write-Host "No expiry by design: R2 tokens ozari-<env>-assets, the Neon org key, the Resend keys, the Google" -ForegroundColor DarkGray
Write-Host "OAuth clients (but Google deletes a client unused for ~6 months). Renewal steps: REBUILD.md §3." -ForegroundColor DarkGray
Write-Host ""
