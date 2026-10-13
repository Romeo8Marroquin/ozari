# =============================================================================
# Ozari — fill AND verify secrets/account.json in one run. Asks only for what no API can tell it.
#
#   ./infrastructure/scripts/account.ps1
#   ./infrastructure/scripts/account.ps1 -GitHubAppInstallationId 12345678
#
# What it asks you for (hidden prompts, each only while still empty):
#   cloudflare_api_token   you create it — the exact permissions are printed when it asks
#   neon_api_key           you create it — where is printed when it asks
#
# What it works out by itself:
#   billing_account            gcloud: your only OPEN billing account (asks if there are several)
#   cloudflare_account_id      Cloudflare API: the account that owns the zone
#   cloudflare_zone_id         Cloudflare API: the zone named -Zone
#   neon_org_id                Neon CLI: your only organization (asks if it cannot tell)
#   github_app_installation_id the -GitHubAppInstallationId argument, else a visible prompt (it is
#                              an id, not a secret)
#
# And then it PROVES the result instead of trusting it:
#   - the Cloudflare token is active and can reach every API the Terraform roots use;
#   - the Neon key can list the organization's projects, and no existing project already carries a
#     name the build would create (neon.ps1 would silently ADOPT such a project instead).
#
# Safe to re-run at any time: it skips what is filled and re-runs every check. GET requests only;
# nothing is created or changed in any cloud. To REPLACE one value: secret.ps1 account <key>.
# =============================================================================
[CmdletBinding()]
param(
    [string]$GitHubAppInstallationId = "",
    [string]$Zone = "partyrentalsgt.com"
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

$data = Read-OzSecrets "account"
$failures = New-Object System.Collections.ArrayList

function Save-Account { Save-OzSecrets -Scope "account" -Data $data }
function Write-Step([string]$Text) { Write-Host ""; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "   OK    $Text" -ForegroundColor Green }
function Write-Bad([string]$Text) { Write-Host "   FAIL  $Text" -ForegroundColor Red; [void]$failures.Add($Text) }

function Invoke-Cf([string]$Path) {
    # GET only. Returns @{ Status; Result } and never throws, so one missing permission is reported
    # alongside the others instead of stopping the run. The token stays in a header, in-process.
    try {
        $r = Invoke-RestMethod -Method Get -Uri "https://api.cloudflare.com/client/v4/$Path" `
            -Headers @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" } -TimeoutSec 30
        return @{ Status = 200; Result = $r.result }
    } catch {
        $code = 0
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        return @{ Status = $code; Result = $null }
    }
}

try {
    # --- 1. Billing account --------------------------------------------------------------------
    Write-Step "Google Cloud billing account"
    if ((Get-OzValue $data "account" "billing_account") -eq "") {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $open = @(gcloud billing accounts list --filter="open=true" --format="value(name.basename())" 2>$null | Where-Object { $_ })
        $ErrorActionPreference = $previous
        if ($open.Count -eq 0) {
            throw "No OPEN billing account is visible to '$(gcloud config get-value account 2>$null)'. Create one at https://console.cloud.google.com/billing (with a payment method), then re-run."
        }
        $choice = $open[0]
        if ($open.Count -gt 1) {
            for ($i = 0; $i -lt $open.Count; $i++) { Write-Host "   [$($i + 1)] $($open[$i])" }
            $n = [int](Read-Host "   Several open billing accounts. Which one (number)")
            $choice = $open[$n - 1]
        }
        Set-OzValue -Data $data -Scope "account" -Key "billing_account" -Value $choice | Out-Null
        Save-Account
        Write-Ok "billing_account = $choice (detected)"
    } else {
        Write-Ok "billing_account already set"
    }

    # --- 2. GitHub App installation id ---------------------------------------------------------
    Write-Step "Cloud Build GitHub App installation"
    if ($GitHubAppInstallationId -ne "") {
        if ($GitHubAppInstallationId -notmatch '^[0-9]+$') { throw "-GitHubAppInstallationId must be digits only." }
        Set-OzValue -Data $data -Scope "account" -Key "github_app_installation_id" -Value $GitHubAppInstallationId | Out-Null
        Save-Account
        Write-Ok "github_app_installation_id = $GitHubAppInstallationId"
    } elseif ((Get-OzValue $data "account" "github_app_installation_id") -eq "") {
        Write-Host "   github.com -> Settings -> Applications -> Installed GitHub Apps -> Google Cloud Build -> Configure."
        Write-Host "   The URL ends in /settings/installations/<number>. (Not installed? Install it, giving it the ozari repo.)"
        $id = (Read-Host "   Installation number").Trim()
        if ($id -notmatch '^[0-9]+$') { throw "Expected digits only. Nothing was saved; re-run." }
        Set-OzValue -Data $data -Scope "account" -Key "github_app_installation_id" -Value $id | Out-Null
        Save-Account
        Write-Ok "github_app_installation_id = $id"
    } else {
        Write-Ok "github_app_installation_id already set"
    }

    # --- 3. Cloudflare token -------------------------------------------------------------------
    Write-Step "Cloudflare API token"
    if ((Get-OzValue $data "account" "cloudflare_api_token") -eq "") {
        Write-Host @"
   Create it: dash.cloudflare.com -> profile icon (top right) -> My Profile -> API Tokens ->
   Create Token -> Custom token -> Get started. Name: ozari-terraform-local. Permissions:
       Account | Workers Scripts    | Edit
       Account | Cloudflare Pages   | Edit
       Account | Workers R2 Storage | Edit
       Zone    | DNS                | Edit
       Zone    | Zone Settings      | Edit
       Zone    | Workers Routes     | Edit
       Zone    | Transform Rules    | Edit
       Zone    | Zone               | Read
   Account Resources: Include -> your account.  Zone Resources: Include -> Specific zone -> $Zone.
   No IP filtering. TTL: about one year (calendar reminder). Create, then copy it (shown once).
"@
        $token = Read-OzHidden "   Paste the token (hidden)"
        if ($token -eq "") { throw "Nothing entered; nothing saved." }
        $env:CLOUDFLARE_API_TOKEN = $token
        $verify = Invoke-Cf "user/tokens/verify"
        if ($verify.Status -ne 200 -or $verify.Result.status -ne "active") {
            throw "Cloudflare does not accept that token (HTTP $($verify.Status)). Nothing was saved. Copy it again and re-run."
        }
        Set-OzValue -Data $data -Scope "account" -Key "cloudflare_api_token" -Value $token | Out-Null
        Save-Account
        $token = $null
    } else {
        $env:CLOUDFLARE_API_TOKEN = Get-OzValue $data "account" "cloudflare_api_token"
    }
    $verify = Invoke-Cf "user/tokens/verify"
    if ($verify.Status -eq 200 -and $verify.Result.status -eq "active") {
        $expires = if ($verify.Result.PSObject.Properties["expires_on"] -and $verify.Result.expires_on) { "expires $($verify.Result.expires_on)" } else { "NO expiry set" }
        Write-Ok "token is active ($expires)"
    } else {
        Write-Bad "token rejected (HTTP $($verify.Status)) - replace it: secret.ps1 account cloudflare_api_token"
    }

    # --- 4. Cloudflare ids, from the API ---------------------------------------------------------
    Write-Step "Cloudflare account + zone ($Zone)"
    $zones = Invoke-Cf "zones?name=$Zone"
    if ($zones.Status -eq 200 -and @($zones.Result).Count -eq 1) {
        $z = @($zones.Result)[0]
        Set-OzValue -Data $data -Scope "account" -Key "cloudflare_zone_id" -Value $z.id | Out-Null
        Set-OzValue -Data $data -Scope "account" -Key "cloudflare_account_id" -Value $z.account.id | Out-Null
        Save-Account
        Write-Ok "cloudflare_zone_id = $($z.id)"
        Write-Ok "cloudflare_account_id = $($z.account.id) ($($z.account.name))"
    } else {
        Write-Bad "the token cannot see zone $Zone (Zone | Zone | Read, and Zone Resources must include it)"
    }

    # --- 5. Every permission the Terraform roots use, probed with a harmless GET -----------------
    $accountId = Get-OzValue $data "account" "cloudflare_account_id"
    $zoneId = Get-OzValue $data "account" "cloudflare_zone_id"
    if ($accountId -ne "" -and $zoneId -ne "") {
        Write-Step "Cloudflare token permissions"
        $probes = [ordered]@{
            "Account | Workers Scripts"    = "accounts/$accountId/workers/scripts"
            "Account | Cloudflare Pages"   = "accounts/$accountId/pages/projects"
            "Account | Workers R2 Storage" = "accounts/$accountId/r2/buckets"
            "Zone    | DNS"                = "zones/$zoneId/dns_records?per_page=1"
            "Zone    | Zone Settings"      = "zones/$zoneId/settings/ssl"
            "Zone    | Workers Routes"     = "zones/$zoneId/workers/routes"
            "Zone    | Transform Rules"    = "zones/$zoneId/rulesets/phases/http_response_headers_transform/entrypoint"
        }
        foreach ($name in $probes.Keys) {
            $s = (Invoke-Cf $probes[$name]).Status
            # 404 on the ruleset entrypoint only means no rule exists yet — the permission is fine.
            if ($s -eq 200 -or ($s -eq 404 -and $name -like "*Transform*")) { Write-Ok $name }
            else { Write-Bad "$name  (HTTP $s) - edit the token and add this permission; no need to create a new one" }
        }
    }

    # --- 6. Neon key ---------------------------------------------------------------------------
    Write-Step "Neon API key"
    if ((Get-OzValue $data "account" "neon_api_key") -eq "") {
        Write-Host "   console.neon.tech -> your organization's Settings -> API keys -> Create new API key."
        Write-Host "   Name: ozari-local. Create it THERE (an organization key), copy it (shown once)."
        $key = Read-OzHidden "   Paste the key (hidden)"
        if ($key -eq "") { throw "Nothing entered; nothing saved." }
        Set-OzValue -Data $data -Scope "account" -Key "neon_api_key" -Value $key | Out-Null
        Save-Account
        $key = $null
    } else {
        Write-Ok "neon_api_key already set (proved in the last step)"
    }
    $env:NEON_API_KEY = Get-OzValue $data "account" "neon_api_key"

    # --- 7. Neon organization ------------------------------------------------------------------
    Write-Step "Neon organization"
    if ((Get-OzValue $data "account" "neon_org_id") -eq "") {
        $orgId = ""
        $orgsJson = Invoke-OzNeonCtl @("orgs", "list", "--output", "json") -AllowFailure
        if ($orgsJson) {
            $parsed = $orgsJson | ConvertFrom-Json
            # @(...) around the whole `if`: PS 5.1 unrolls a one-item array into a bare object, whose
            # .Count is EMPTY there — so "exactly one org" would never match.
            $orgs = @(if ($parsed.PSObject.Properties["organizations"]) { $parsed.organizations } else { $parsed })
            if ($orgs.Count -eq 1) { $orgId = $orgs[0].id }
        }
        if ($orgId -eq "") {
            # Expected with an ORGANIZATION key: listing your organizations is a personal-account call.
            Write-Host "   An organization key cannot list organizations (expected), so: console.neon.tech ->"
            Write-Host "   organization Settings -> General -> Organization ID. It is an id, not a secret."
            $orgId = (Read-Host "   Organization ID (org-...)").Trim()
        }
        if ($orgId -notmatch '^org-[a-z0-9-]+$') { throw "'$orgId' does not look like a Neon organization id (org-...). Nothing was saved." }
        Set-OzValue -Data $data -Scope "account" -Key "neon_org_id" -Value $orgId | Out-Null
        Save-Account
        Write-Ok "neon_org_id = $orgId (detected or entered)"
    } else {
        Write-Ok "neon_org_id already set"
    }

    # --- 8. Neon: the key works for that org, and no name collides --------------------------------
    Write-Step "Neon access + existing projects"
    $orgId = Get-OzValue $data "account" "neon_org_id"
    $listJson = Invoke-OzNeonCtl @("projects", "list", "--org-id", $orgId, "--output", "json") -AllowFailure
    if (-not $listJson) {
        Write-Bad "the Neon key cannot list projects in $orgId - wrong key or org; replace with secret.ps1 account neon_api_key / neon_org_id"
    } else {
        $parsed = $listJson | ConvertFrom-Json
        $projects = @(if ($parsed.PSObject.Properties["projects"]) { $parsed.projects } else { $parsed })
        Write-Ok "key works ($($projects.Count) existing project(s) in the organization)"
        foreach ($p in $projects) { Write-Host "         - $($p.name)  ($($p.region_id), Postgres $($p.pg_version))" }
        foreach ($envName in @("staging", "prod")) {
            $want = (Get-OzEnvironment $envName).neon.project_name
            $clash = $projects | Where-Object { $_.name -eq $want }
            if ($clash) {
                Write-Host "   NOTE  a project named '$want' already exists. neon.ps1 $envName will REUSE it, not create a new one." -ForegroundColor Yellow
                Write-Host "         If it is the OLD database, rename it in the Neon console (Settings -> General) to '$want-old'." -ForegroundColor Yellow
            }
        }
    }

    # --- Summary -------------------------------------------------------------------------------
    Write-Host ""
    $missing = @(Get-OzMissing $data "account")
    if ($failures.Count -eq 0 -and $missing.Count -eq 0) {
        Write-Host "account.json is complete and every check passed." -ForegroundColor Green
    } else {
        if ($missing.Count -gt 0) { Write-Host "Still empty: $($missing -join ', ')" -ForegroundColor Yellow }
        if ($failures.Count -gt 0) { Write-Host "$($failures.Count) check(s) failed - see FAIL above, fix, and re-run." -ForegroundColor Red }
        exit 1
    }
} finally {
    Clear-OzProcessSecrets
}
