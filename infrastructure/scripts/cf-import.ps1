# =============================================================================
# Ozari — discover existing Cloudflare objects and generate Terraform import blocks.
#
#   $env:CLOUDFLARE_API_TOKEN = "..."
#   ./cf-import.ps1 -Environment staging
#
# WHY THIS EXISTS. The zone is real, live and already configured. Pointing Terraform at it without
# telling it what already exists produces "record already exists" on every apply — Terraform assumes
# it must CREATE what it declares. Importing first means Terraform adopts the live objects into
# state, compares them against the config, and then shows you a diff of the REAL differences. If the
# config already matches, the plan is empty and the objects are simply now managed.
#
# ⚠️ IT ONLY EVER EMITS IMPORTS FOR OBJECTS THIS ENVIRONMENT OWNS. Everything else on the account —
# notably the unrelated `qa-ulew` landing page — is listed in the inventory as NOT OURS and is never
# written into an import block. Read the inventory before you apply anything.
#
# ⚠️ THE DOMAIN ITSELF IS NEVER MANAGED. There is no `cloudflare_zone` and no registrar resource
# anywhere in this repo, by design: the registration and the zone are account-level, user-facing
# assets like the Google OAuth client. Terraform manages the RECORDS inside the zone, never the zone.
# A `terraform destroy` here removes records; it cannot remove, transfer, disable or fail to renew
# the domain.
#
# Read-only: this script performs GET requests only and writes one local file.
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet("staging", "prod")]
    [string]$Environment,

    # Overrides. Defaults are read from the environment's terraform.tfvars where possible.
    [string]$AccountId = "",
    [string]$ZoneId = "",
    [string]$ApiHostname = "",
    [string]$AppHostname = "",
    [string]$WorkerName = "",
    [string]$PagesProject = "",
    [string]$R2Bucket = "",

    # Print the inventory but do not write imports.generated.tf.
    [switch]$InventoryOnly
)

$ErrorActionPreference = "Stop"

if (-not $env:CLOUDFLARE_API_TOKEN) {
    throw "CLOUDFLARE_API_TOKEN is not set. `$env:CLOUDFLARE_API_TOKEN = '<token>'"
}

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$EnvDir = Join-Path $RepoRoot "infrastructure\terraform\envs\$Environment\cloudflare"
if (-not (Test-Path $EnvDir)) { throw "No such environment directory: $EnvDir" }

# --- Fill the blanks from terraform.tfvars, then from per-environment defaults ---
$tfvars = Join-Path $EnvDir "terraform.tfvars"
function Get-TfVar {
    param([string]$Name)
    if (-not (Test-Path $tfvars)) { return "" }
    $line = Select-String -Path $tfvars -Pattern "^\s*$Name\s*=\s*`"([^`"]*)`"" | Select-Object -First 1
    if ($line) { return $line.Matches[0].Groups[1].Value }
    return ""
}

if (-not $AccountId) { $AccountId = Get-TfVar "cloudflare_account_id" }
if (-not $ZoneId) { $ZoneId = Get-TfVar "cloudflare_zone_id" }
if (-not $PagesProject) { $PagesProject = Get-TfVar "pages_project_name" }
if (-not $R2Bucket) { $R2Bucket = Get-TfVar "r2_bucket_name" }

if ($Environment -eq "staging") {
    if (-not $ApiHostname) { $ApiHostname = "api-staging.partyrentalsgt.com" }
    if (-not $AppHostname) { $AppHostname = "staging.partyrentalsgt.com" }
    if (-not $WorkerName) { $WorkerName = "api-staging-proxy" }
    if (-not $PagesProject) { $PagesProject = "ozari-c28" }
    if (-not $R2Bucket) { $R2Bucket = "ozari-assets-staging" }
} else {
    if (-not $ApiHostname) { $ApiHostname = "api.partyrentalsgt.com" }
    if (-not $AppHostname) { $AppHostname = "partyrentalsgt.com" }
    if (-not $WorkerName) { $WorkerName = "api-proxy" }
    if (-not $PagesProject) { $PagesProject = "ozari-prod" }
    if (-not $R2Bucket) { $R2Bucket = "ozari-assets-prod" }
}

if (-not $AccountId -or -not $ZoneId) {
    throw "cloudflare_account_id / cloudflare_zone_id not found. Fill $tfvars or pass -AccountId/-ZoneId."
}

$Headers = @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" }
$Api = "https://api.cloudflare.com/client/v4"

function Invoke-CF {
    param([string]$Path)
    try {
        $r = Invoke-RestMethod -Uri "$Api/$Path" -Headers $Headers -Method GET
        if (-not $r.success) { Write-Warning "Cloudflare API returned success=false for $Path"; return $null }
        return $r.result
    } catch {
        Write-Warning "GET $Path failed: $($_.Exception.Message)"
        return $null
    }
}

$ours = @{}      # terraform address -> import id
$inventory = @() # what exists, and whether we claim it

function Add-Row {
    param([string]$Kind, [string]$Name, [string]$Id, [bool]$Mine, [string]$Address = "")
    $script:inventory += [pscustomobject]@{
        Kind = $Kind; Name = $Name; Id = $Id
        Owner = $(if ($Mine) { "OURS" } else { "not ours — leave alone" })
        Address = $Address
    }
    if ($Mine -and $Address) { $script:ours[$Address] = $Id }
}

Write-Host ""
Write-Host "Inventorying Cloudflare for '$Environment' ..." -ForegroundColor Cyan
Write-Host "  account $AccountId / zone $ZoneId"
Write-Host ""

# --- DNS records ------------------------------------------------------------
# Only the two hostnames this environment owns. Every other record on the zone — apex, mail,
# verification TXTs, whatever the landing page uses — is listed and never claimed.
$records = Invoke-CF "zones/$ZoneId/dns_records?per_page=200"
foreach ($r in $records) {
    $mine = $false; $addr = ""
    if ($r.name -eq $ApiHostname -and $r.type -eq "CNAME") { $mine = $true; $addr = "module.cloudflare.cloudflare_dns_record.api" }
    elseif ($r.name -eq $AppHostname -and $r.type -eq "CNAME") { $mine = $true; $addr = "module.cloudflare.cloudflare_dns_record.app" }
    Add-Row "dns" "$($r.type) $($r.name) -> $($r.content)" "$ZoneId/$($r.id)" $mine $addr
}

# --- Workers ----------------------------------------------------------------
$scripts = Invoke-CF "accounts/$AccountId/workers/scripts"
foreach ($s in $scripts) {
    $mine = ($s.id -eq $WorkerName)
    Add-Row "worker" $s.id "$AccountId/$($s.id)" $mine $(if ($mine) { "module.cloudflare.cloudflare_worker.api_proxy" } else { "" })
}

$routes = Invoke-CF "zones/$ZoneId/workers/routes"
foreach ($rt in $routes) {
    $mine = ($rt.script -eq $WorkerName)
    Add-Row "worker-route" "$($rt.pattern) -> $($rt.script)" "$ZoneId/$($rt.id)" $mine $(if ($mine) { "module.cloudflare.cloudflare_workers_route.api_proxy" } else { "" })
}

# --- Pages ------------------------------------------------------------------
$projects = Invoke-CF "accounts/$AccountId/pages/projects"
foreach ($p in $projects) {
    $mine = ($p.name -eq $PagesProject)
    Add-Row "pages" $p.name "$AccountId/$($p.name)" $mine $(if ($mine) { "module.cloudflare.cloudflare_pages_project.app" } else { "" })
    if ($mine) {
        foreach ($d in $p.domains) {
            if ($d -eq $AppHostname) {
                Add-Row "pages-domain" $d "$AccountId/$($p.name)/$d" $true "module.cloudflare.cloudflare_pages_domain.app"
            }
        }
    }
}

# --- R2 ---------------------------------------------------------------------
$buckets = Invoke-CF "accounts/$AccountId/r2/buckets"
foreach ($b in $buckets.buckets) {
    $mine = ($b.name -eq $R2Bucket)
    Add-Row "r2-bucket" $b.name "$AccountId/$($b.name)/default" $mine $(if ($mine) { "module.cloudflare.cloudflare_r2_bucket.assets" } else { "" })
}

# --- Rulesets ---------------------------------------------------------------
$rulesets = Invoke-CF "zones/$ZoneId/rulesets"
foreach ($rs in $rulesets) {
    $mine = ($rs.name -eq "ozari-$Environment-noindex")
    Add-Row "ruleset" "$($rs.name) [$($rs.phase)]" "zones/$ZoneId/$($rs.id)" $mine $(if ($mine) { "module.cloudflare.cloudflare_ruleset.noindex[0]" } else { "" })
}

# --- Zone settings ----------------------------------------------------------
# Settings always exist, so there is nothing to discover — but they still have to be imported, or
# Terraform treats "set ssl = strict" as a create and the first apply looks like a change to a zone
# it does not yet know the state of.
$manageZone = (Get-TfVar "manage_zone_settings") -ne "false"
if ($manageZone) {
    Add-Row "zone-setting" "ssl" "$ZoneId/ssl" $true "module.cloudflare.cloudflare_zone_setting.ssl[0]"
    Add-Row "zone-setting" "always_use_https" "$ZoneId/always_use_https" $true "module.cloudflare.cloudflare_zone_setting.always_use_https[0]"
}

# --- Report -----------------------------------------------------------------
Write-Host "INVENTORY" -ForegroundColor Cyan
$inventory | Sort-Object Kind, Name | Format-Table Kind, Name, Owner -AutoSize | Out-String | Write-Host

$notOurs = @($inventory | Where-Object { $_.Owner -ne "OURS" })
if ($notOurs.Count -gt 0) {
    Write-Host "$($notOurs.Count) object(s) on this account are NOT ours and were not claimed." -ForegroundColor Yellow
    Write-Host "Confirm every one of them belongs to another project (e.g. qa-ulew) before applying." -ForegroundColor Yellow
    Write-Host ""
}

if ($InventoryOnly) { return }

# --- Emit -------------------------------------------------------------------
$outFile = Join-Path $EnvDir "imports.generated.tf"
$sb = [System.Text.StringBuilder]::new()
[void]$sb.AppendLine("# GENERATED by infrastructure/scripts/cf-import.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm').")
[void]$sb.AppendLine("# Environment: $Environment.  DO NOT EDIT BY HAND — re-run the script instead.")
[void]$sb.AppendLine("#")
[void]$sb.AppendLine('# These adopt EXISTING Cloudflare objects into Terraform state. Run `terraform plan` after')
[void]$sb.AppendLine('# generating this: expect imports plus whatever real differences exist between the live')
[void]$sb.AppendLine('# objects and the config. An empty diff means the live config already matches.')
[void]$sb.AppendLine("#")
[void]$sb.AppendLine("# ⚠️ NOT IMPORTABLE, and deliberately absent:")
[void]$sb.AppendLine("#   · cloudflare_r2_bucket_cors — the provider supports no import for it. Terraform will")
[void]$sb.AppendLine("#     CREATE it, which is safe: the CORS API is a full replace, so applying our policy over")
[void]$sb.AppendLine("#     an existing one is the intended outcome rather than a conflict.")
[void]$sb.AppendLine("#   · cloudflare_worker_version / _workers_deployment — versions are immutable by design, so")
[void]$sb.AppendLine("#     Terraform uploads our script as a NEW version and points traffic at it. That is correct:")
[void]$sb.AppendLine("#     after this, the deployed worker is the one in this repository.")
[void]$sb.AppendLine("#   · the zone and the domain registration — never managed here, by design.")
[void]$sb.AppendLine("")

if ($ours.Count -eq 0) {
    [void]$sb.AppendLine("# Nothing found to import — this environment does not exist on Cloudflare yet.")
    [void]$sb.AppendLine("# That is the expected result for a from-scratch build; delete this file and apply.")
} else {
    foreach ($addr in ($ours.Keys | Sort-Object)) {
        [void]$sb.AppendLine("import {")
        [void]$sb.AppendLine("  to = $addr")
        [void]$sb.AppendLine("  id = `"$($ours[$addr])`"")
        [void]$sb.AppendLine("}")
        [void]$sb.AppendLine("")
    }
}

Set-Content -Path $outFile -Value $sb.ToString() -Encoding utf8
Write-Host "Wrote $($ours.Count) import block(s) to:" -ForegroundColor Green
Write-Host "  $outFile"
Write-Host ""
Write-Host "Next:"
Write-Host "  ./scripts/tf.ps1 $Environment cloudflare plan    # imports + the real diff"
Write-Host "  ./scripts/tf.ps1 $Environment cloudflare apply"
Write-Host ""
Write-Host "Delete imports.generated.tf once the objects are in state — an import block for a resource"
Write-Host "already in state is a harmless no-op, but the file stops being true the moment anything changes."
Write-Host ""
