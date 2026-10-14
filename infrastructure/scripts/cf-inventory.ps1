# =============================================================================
# Ozari — READ-ONLY inventory of the Cloudflare account, classified for one environment.
#
#   ./infrastructure/scripts/cf-inventory.ps1 staging
#
# Every object on the account is labelled:
#   OURS       created by this environment's Terraform (expected after the first apply)
#   CONFLICT   holds a hostname or name this environment's apply will create → the apply fails with
#              "already exists" until it is deleted. Before a rebuild this is the pre-rebuild
#              staging (Pages `ozari-c28`, Worker `api-staging-proxy`, bucket `ozari-assets-staging`,
#              and their DNS records / domains). `retire.ps1 legacy-staging -Execute` deletes them.
#   not ours   anything else — notably the unrelated `qa-ulew` landing page. NEVER touched.
#
# It also prints the build settings of any CONFLICT Pages project, so values configured by hand in
# the old dashboard (NODE_VERSION, PNPM_VERSION, …) can be carried into `pages_build_env`.
#
# GET requests only. Uses the token in secrets/account.json.
# ⚠️ The DOMAIN and the ZONE are never managed anywhere in this repo — only records inside it.
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("staging", "prod")]
    [string]$Environment
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

# The names live in ONE table (Get-OzTarget in lib/Ozari.Infra.psm1), shared with retire.ps1.
$t = Get-OzTarget $Environment
$e = @{ hosts = $t.hosts; worker = $t.workers[0]; pages = $t.pages[0]; bucket = $t.buckets[0] }
# Names that were ours before the rebuild. Listed so they are recognised as CONFLICT, not "not ours".
$old = Get-OzTarget "legacy-staging"
$legacy = @{ pages = $old.pages; worker = $old.workers; bucket = $old.buckets }

try {
    $acct = Import-OzAccount -Require @("cloudflare_account_id", "cloudflare_zone_id", "cloudflare_api_token")
    $accountId = $acct.cloudflare_account_id
    $zoneId = $acct.cloudflare_zone_id
    $headers = @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" }

    function Get-CF([string]$Path) {
        try {
            $r = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/$Path" -Headers $headers -Method Get
            if (-not $r.success) { Write-Warning "success=false for $Path"; return $null }
            return $r.result
        } catch {
            Write-Warning "GET $Path failed: $($_.Exception.Message)"
            return $null
        }
    }

    $rows = New-Object System.Collections.ArrayList
    function Add-Row([string]$Kind, [string]$Name, [string]$Label, [string]$Hint = "") {
        [void]$rows.Add([pscustomobject]@{ Label = $Label; Kind = $Kind; Name = $Name; Hint = $Hint })
    }

    $conflictPages = @()

    # --- DNS ---------------------------------------------------------------------
    foreach ($r in @(Get-CF "zones/$zoneId/dns_records?per_page=500")) {
        if (-not $r) { continue }
        $desc = "$($r.type) $($r.name) -> $($r.content)"
        if ($e.hosts -contains $r.name) {
            if ($r.comment -and $r.comment -like "*Terraform-managed*") { Add-Row "dns" $desc "OURS" }
            elseif ($r.content -like "*r2*" -or ($r.meta -and $r.meta.read_only)) { Add-Row "dns" $desc "CONFLICT" "an R2 custom-domain record: remove the custom domain from its bucket (R2 → bucket → Settings)" }
            else { Add-Row "dns" $desc "CONFLICT" "delete the record (DNS → Records)" }
        } else { Add-Row "dns" $desc "not ours" }
    }

    # --- Workers + routes ------------------------------------------------------
    foreach ($s in @(Get-CF "accounts/$accountId/workers/scripts")) {
        if (-not $s) { continue }
        if ($s.id -eq $e.worker) { Add-Row "worker" $s.id "OURS" }
        elseif ($legacy.worker -contains $s.id) { Add-Row "worker" $s.id "CONFLICT" "pre-rebuild Worker: delete it (Workers & Pages → it → Settings → Delete)" }
        else { Add-Row "worker" $s.id "not ours" }
    }
    foreach ($rt in @(Get-CF "zones/$zoneId/workers/routes")) {
        if (-not $rt) { continue }
        $routeHost = ($rt.pattern -split '/')[0]
        $desc = "$($rt.pattern) -> $($rt.script)"
        if ($e.hosts -contains $routeHost) {
            if ($rt.script -eq $e.worker) { Add-Row "route" $desc "OURS" } else { Add-Row "route" $desc "CONFLICT" "delete the route (zone → Workers Routes)" }
        } else { Add-Row "route" $desc "not ours" }
    }

    # --- Pages -------------------------------------------------------------------
    foreach ($p in @(Get-CF "accounts/$accountId/pages/projects")) {
        if (-not $p) { continue }
        $holds = @($p.domains | Where-Object { $e.hosts -contains $_ })
        if ($p.name -eq $e.pages) { Add-Row "pages" "$($p.name) ($($p.subdomain))" "OURS" }
        elseif ($legacy.pages -contains $p.name -or $holds.Count -gt 0) {
            Add-Row "pages" "$($p.name) [domains: $($p.domains -join ', ')]" "CONFLICT" "pre-rebuild project: delete it (Workers & Pages → it → Settings → Delete project)"
            $conflictPages += $p
        } else { Add-Row "pages" $p.name "not ours" }
    }

    # --- R2 ----------------------------------------------------------------------
    $buckets = Get-CF "accounts/$accountId/r2/buckets"
    foreach ($b in @($(if ($buckets) { $buckets.buckets } else { @() }))) {
        if (-not $b) { continue }
        $custom = Get-CF "accounts/$accountId/r2/buckets/$($b.name)/domains/custom"
        $domains = @($(if ($custom) { $custom.domains | ForEach-Object { $_.domain } } else { @() }))
        $desc = "$($b.name) [custom domains: $($domains -join ', ')]"
        if ($b.name -eq $e.bucket) { Add-Row "r2" $desc "OURS" }
        elseif ($legacy.bucket -contains $b.name -or @($domains | Where-Object { $e.hosts -contains $_ }).Count -gt 0) {
            Add-Row "r2" $desc "CONFLICT" "remove its custom domain; then empty and delete the bucket (it holds only disposable staging photos)"
        } else { Add-Row "r2" $desc "not ours" }
    }

    # --- Zone rulesets: ONE per phase per zone ------------------------------------
    # Cloudflare allows a single zone ruleset per phase. Staging's noindex rule lives in the
    # response-header phase, so any ruleset already there blocks the apply ("exceeded maximum number of
    # zone rulesets") — and replacing it would wipe its rules. Listed rule by rule so the decision is
    # made on what it actually contains.
    $phase = "http_response_headers_transform"
    $rulesetDetail = $null
    $entry = Get-CF "zones/$zoneId/rulesets/phases/$phase/entrypoint"
    if ($entry) {
        $ours = "ozari-$Environment-noindex"
        $desc = "$($entry.name) [$phase, $(@($entry.rules).Count) rule(s), id $($entry.id)]"
        if ($entry.name -eq $ours) {
            Add-Row "ruleset" $desc "OURS"
        } elseif ($entry.name -match '^ozari-(staging|prod)-noindex$') {
            # Another CURRENT environment's rule, owned by its own Terraform state. Only staging sets
            # noindex_hostname, so production creates nothing in this phase and does not collide.
            # Never delete it: the staging site would become indexable.
            Add-Row "ruleset" $desc "not ours" "owned by the $($Matches[1]) cloudflare root — leave it"
        } else {
            Add-Row "ruleset" $desc "CONFLICT" "inspect the rules below. Only old-staging rules: retire.ps1 legacy-staging -Execute deletes the whole ruleset. Anything else: tell Claude, so Terraform can carry those rules."
            $rulesetDetail = $entry
        }
    }

    # --- Report ------------------------------------------------------------------
    Write-Host ""
    Write-Host "Cloudflare inventory for '$Environment' (account $accountId, zone $zoneId)" -ForegroundColor Cyan
    $rows | Sort-Object @{ Expression = { @{ "CONFLICT" = 0; "OURS" = 1; "not ours" = 2 }[$_.Label] } }, Kind, Name |
        Format-Table Label, Kind, Name -AutoSize -Wrap | Out-String -Width 220 | Write-Host

    $conflicts = @($rows | Where-Object { $_.Label -eq "CONFLICT" })
    if ($conflicts.Count -gt 0) {
        Write-Host "$($conflicts.Count) CONFLICT(s) — delete these before 'tf.ps1 $Environment cloudflare apply':" -ForegroundColor Yellow
        foreach ($c in $conflicts) { Write-Host "  · [$($c.Kind)] $($c.Name)`n      → $($c.Hint)" -ForegroundColor Yellow }
        Write-Host ""
    } else {
        Write-Host "No conflicts. The apply will not collide with anything on the account." -ForegroundColor Green
        Write-Host ""
    }

    if ($rulesetDetail) {
        Write-Host "Rules in '$($rulesetDetail.name)' ($phase):" -ForegroundColor Cyan
        foreach ($r in @($rulesetDetail.rules)) {
            if (-not $r) { continue }
            $headers = ""
            if ($r.action_parameters -and $r.action_parameters.headers) {
                $headers = ($r.action_parameters.headers.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value.value)" }) -join "; "
            }
            Write-Host "  - [$(if ($r.enabled) { 'on' } else { 'off' })] $($r.description)"
            Write-Host "      when: $($r.expression)"
            if ($headers) { Write-Host "      sets: $headers" }
        }
        Write-Host ""
    }

    foreach ($p in $conflictPages) {
        $full = Get-CF "accounts/$accountId/pages/projects/$($p.name)"
        if (-not $full) { continue }
        Write-Host "Build settings of '$($p.name)' (carry anything relevant into pages_build_env):" -ForegroundColor Cyan
        Write-Host "  build command : $($full.build_config.build_command)"
        Write-Host "  output dir    : $($full.build_config.destination_dir)"
        Write-Host "  root dir      : $($full.build_config.root_dir)"
        $vars = $full.deployment_configs.production.env_vars
        if ($vars) {
            foreach ($v in $vars.PSObject.Properties) {
                $shown = if ($v.Value.type -eq "secret_text") { "<secret>" } else { $v.Value.value }
                Write-Host "  env  $($v.Name) = $shown"
            }
        }
        Write-Host ""
    }
} finally {
    Clear-OzProcessSecrets
}
