# =============================================================================
# Ozari — RETIRE an environment: delete everything it owns in Cloudflare, Neon and Google Cloud.
#
#   ./infrastructure/scripts/retire.ps1 legacy-staging            # DRY RUN: lists what would go
#   ./infrastructure/scripts/retire.ps1 legacy-staging -Execute   # deletes it, after you type the name
#
# Targets (names in ONE table: Get-OzTarget in lib/Ozari.Infra.psm1):
#   legacy-staging   the pre-rebuild staging: project ozari-500103, Neon project "ozari", Pages
#                    ozari-c28, Worker api-staging-proxy, bucket ozari-assets-staging, and the
#                    staging./api-staging./assets-stg. records. Run it BEFORE the new staging's
#                    Cloudflare apply: they hold the same hostnames.
#   staging | prod   one of the rebuilt environments (REBUILD.md §5).
#
# Order, chosen so a half-finished run is always safe to re-run:
#   1. harvest   (legacy only) values worth keeping are copied into secrets/<env>.json first
#   2. Cloudflare Worker routes, Worker custom domains, Worker scripts, Pages projects (their
#                 domains and deployments first), R2 buckets (custom domain, objects, bucket), and
#                 finally any DNS record still holding one of the target's hostnames
#   3. Neon      the project — its database, branches and roles go with it
#   4. Google    the project LAST: it holds the R2 keys used to empty the bucket and the harvested
#                 values, so it is skipped while anything above failed. Google keeps a deleted
#                 project recoverable for 30 days (`gcloud projects undelete <id>`).
#
# Least privilege: it uses only the credentials already in account.json (no new permission), deletes
# ONLY exact names from the table, and never touches anything else on the account — the domain, the
# zone, other DNS records (on the target's own hostnames only A/AAAA/CNAME go; MX, TXT and CAA stay),
# qa-ulew. Nothing secret is printed. Re-runnable: what is gone is skipped.
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("legacy-staging", "staging", "prod")]
    [string]$Target,

    [switch]$Execute
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

$t = Get-OzTarget $Target
$failures = New-Object System.Collections.ArrayList

function Write-Step([string]$Text) { Write-Host ""; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Item([string]$Text) {
    $verb = if ($Execute) { "delete " } else { "WILL DELETE" }
    Write-Host "   $verb  $Text" -ForegroundColor Yellow
}
function Write-None { Write-Host "   (nothing)" -ForegroundColor DarkGray }
function Write-Ok([string]$Text) { Write-Host "   OK     $Text" -ForegroundColor Green }
function Write-Bad([string]$Text) { Write-Host "   FAIL   $Text" -ForegroundColor Red; [void]$failures.Add($Text) }

function Invoke-Cf([string]$Method, [string]$Path) {
    # Never throws, so one failure is reported alongside the rest. The token stays in a header.
    try {
        $r = Invoke-RestMethod -Method $Method -Uri "https://api.cloudflare.com/client/v4/$Path" `
            -Headers @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" } -TimeoutSec 60
        return @{ Ok = $true; Status = 200; Result = $r.result; Error = "" }
    } catch {
        $code = 0
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        $msg = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
        return @{ Ok = $false; Status = $code; Result = $null; Error = $msg }
    }
}

function Invoke-Gcloud([string[]]$Arguments, [switch]$Quiet) {
    # Continue, not Stop: under Stop, Windows PowerShell turns a native tool's redirected stderr into a
    # terminating error before the exit code can be read.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        if ($Quiet) { $out = & gcloud @Arguments 2>$null } else { $out = & gcloud @Arguments }
        return @{ Code = $LASTEXITCODE; Out = (($out | ForEach-Object { "$_" }) -join "`n").Trim() }
    } finally {
        $ErrorActionPreference = $previous
    }
}

function Get-ProjectState([string]$ProjectId) {
    # ACTIVE, DELETE_REQUESTED, or "" when it does not exist (or this login cannot see it).
    return (Invoke-Gcloud @("projects", "describe", $ProjectId, "--format=value(lifecycleState)") -Quiet).Out
}

function Get-OldSecret([string]$SecretId) {
    # The value lands in a variable, never on screen. "" when the secret or the project is gone.
    $r = Invoke-Gcloud @("secrets", "versions", "access", "latest", "--secret=$SecretId", "--project=$($t.gcp_project)") -Quiet
    if ($r.Code -ne 0) { return "" }
    return $r.Out
}

try {
    $acct = Import-OzAccount -Require @("cloudflare_account_id", "cloudflare_zone_id", "cloudflare_api_token", "neon_api_key", "neon_org_id")
    $a = $acct.cloudflare_account_id
    $z = $acct.cloudflare_zone_id
    $orgId = $acct.neon_org_id

    Write-Host ""
    if ($Execute) {
        Write-Host "RETIRE '$Target' - EXECUTE" -ForegroundColor Red
    } else {
        Write-Host "RETIRE '$Target' - DRY RUN (nothing is changed)" -ForegroundColor Cyan
    }

    # ===================================================================================== DISCOVER
    $gcpState = Get-ProjectState $t.gcp_project
    $survivorState = Get-ProjectState $t.survivor

    # --- Harvest (legacy only) -------------------------------------------------------------------
    $harvest = @{}
    if ($t.legacy -and $gcpState -eq "ACTIVE") {
        Write-Step "Values carried into secrets/$($t.harvest_into).json (instead of minting them again)"
        $envData = Read-OzSecrets $t.harvest_into
        foreach ($secretId in $t.harvest.Keys) {
            $key = $t.harvest[$secretId]
            if ((Get-OzValue $envData $t.harvest_into $key) -ne "") { Write-Host "   skip   $key (already set)" -ForegroundColor DarkGray; continue }
            $value = Get-OldSecret $secretId
            if ($key -eq "email_key" -and $value -notmatch '^re_') { Write-Host "   skip   $key ($secretId missing or not a Resend key; mint a new one later)" -ForegroundColor DarkGray; continue }
            if ($value -eq "") { Write-Host "   skip   $key ($secretId not found)" -ForegroundColor DarkGray; continue }
            $harvest[$key] = $value
            $verb = if ($Execute) { "copy" } else { "WILL COPY" }
            Write-Host "   $verb  $secretId -> $key" -ForegroundColor Green
        }
    }

    # --- Cloudflare ---------------------------------------------------------------------------------
    Write-Step "Cloudflare (account $a)"
    # A rejected token would make every lookup below come back empty, which reads as "nothing to delete".
    if (-not (Invoke-Cf "Get" "user/tokens/verify").Ok) {
        Write-Bad "the Cloudflare token is rejected (re-run ./infrastructure/scripts/account.ps1 to diagnose)"
    }
    $allScripts = @((Invoke-Cf "Get" "accounts/$a/workers/scripts").Result | Where-Object { $_ })
    $scripts = @($allScripts | Where-Object { $t.workers -contains $_.id })
    $routes = @((Invoke-Cf "Get" "zones/$z/workers/routes").Result | Where-Object { $_ -and $t.workers -contains $_.script })
    $workerDomains = @((Invoke-Cf "Get" "accounts/$a/workers/domains").Result | Where-Object { $_ -and $t.workers -contains $_.service })

    # A legacy target shares its hostnames — and possibly NAMES (the old bucket may already be called
    # ozari-staging-assets) — with the new staging. While the new staging's edge does not exist,
    # everything holding those hostnames is the old one. Once it exists, its objects and DNS are off
    # limits, because they may be the new ones.
    $successorExists = $false
    if ($t.legacy) {
        $successorScripts = @($allScripts | Where-Object { $t.successor.workers -contains $_.id })
        $successorPages = @($t.successor.pages | Where-Object { (Invoke-Cf "Get" "accounts/$a/pages/projects/$_").Ok })
        $successorExists = ($successorScripts.Count + $successorPages.Count) -gt 0
    }
    # Separate lists: a Pages project and a bucket can share a name (the old bucket is `ozari-staging`,
    # the new Pages project is `ozari-staging`), so one combined list would protect the wrong thing.
    $notOurPages = @()
    $notOurBuckets = @()
    if ($successorExists) { $notOurPages = @($t.successor.pages); $notOurBuckets = @($t.successor.buckets) }

    # Pages projects and R2 buckets are found by NAME or by holding one of the target's HOSTNAMES. A
    # dashboard-made project's name is not its address (`ozari` serves `ozari-c28.pages.dev` when the
    # plain name was taken), so a name list alone misses it.

    $pages = @()
    foreach ($p in @((Invoke-Cf "Get" "accounts/$a/pages/projects").Result | Where-Object { $_ })) {
        if ($notOurPages -contains $p.name) { continue }
        $holds = @(@($p.domains) | Where-Object { $t.hosts -contains $_ })
        if ($t.pages -contains $p.name -or $holds.Count -gt 0) {
            # The list omits build settings; the single-project read has them (printed below for legacy).
            $full = Invoke-Cf "Get" "accounts/$a/pages/projects/$($p.name)"
            $pages += $(if ($full.Ok) { $full.Result } else { $p })
        }
    }

    $buckets = @()
    $bucketList = (Invoke-Cf "Get" "accounts/$a/r2/buckets").Result
    foreach ($b in @($(if ($bucketList -and $bucketList.buckets) { $bucketList.buckets } else { @() }))) {
        if (-not $b -or $notOurBuckets -contains $b.name) { continue }
        $custom = (Invoke-Cf "Get" "accounts/$a/r2/buckets/$($b.name)/domains/custom").Result
        $domains = @($(if ($custom -and $custom.domains) { $custom.domains | ForEach-Object { $_.domain } } else { @() }))
        if ($t.buckets -contains $b.name -or @($domains | Where-Object { $t.hosts -contains $_ }).Count -gt 0) {
            $buckets += @{ name = $b.name; domains = $domains }
        }
    }

    $dnsRefused = $successorExists
    # Only the record types that POINT a hostname somewhere. The apex also carries MX, TXT (SPF, site
    # verifications) and CAA records that have nothing to do with any environment and must survive.
    $dnsTypes = @("A", "AAAA", "CNAME")
    $dns = @()
    if (-not $dnsRefused) {
        foreach ($h in $t.hosts) {
            foreach ($r in @((Invoke-Cf "Get" "zones/$z/dns_records?name=$h").Result | Where-Object { $_ -and $dnsTypes -contains $_.type })) { $dns += $r }
        }
    }

    # The zone's response-header ruleset. Cloudflare allows ONE per phase per zone, so an old one blocks
    # the next environment's noindex rule. It goes when it is this target's own (by name), or — for a
    # legacy target — when EVERY hostname its rules mention is one of the target's. A ruleset with any
    # other rule in it is left alone and reported.
    $rsPhase = "http_response_headers_transform"
    $ruleset = $null
    $rsEntry = Invoke-Cf "Get" "zones/$z/rulesets/phases/$rsPhase/entrypoint"
    if ($rsEntry.Ok -and $rsEntry.Result) {
        $rs = $rsEntry.Result
        $mentioned = @(@($rs.rules) | ForEach-Object { [regex]::Matches([string]$_.expression, '[a-z0-9-]+(\.[a-z0-9-]+)+\.[a-z]{2,}') } | ForEach-Object { $_.Value } | Sort-Object -Unique)
        $onlyTarget = $mentioned.Count -gt 0 -and @($mentioned | Where-Object { $t.hosts -notcontains $_ }).Count -eq 0
        $successorName = "ozari-$($t.harvest_into)-noindex"
        if ($rs.name -eq "ozari-$($t.name)-noindex" -or ($t.legacy -and -not $successorExists -and $rs.name -ne $successorName -and $onlyTarget)) {
            $ruleset = $rs
        } elseif ($t.legacy -and -not $successorExists -and $rs.name -ne $successorName) {
            Write-Host "   NOTE   zone ruleset '$($rs.name)' ($rsPhase) holds rules for other hostnames ($($mentioned -join ', ')); left alone." -ForegroundColor Yellow
        }
    }
    if ($ruleset) {
        $desc = (@($ruleset.rules) | ForEach-Object { $_.description }) -join '; '
        Write-Item "Zone ruleset   $($ruleset.name) [$rsPhase, $(@($ruleset.rules).Count) rule(s): $desc]"
    }

    # A record that R2 manages proves some bucket holds that hostname. If none was matched, stop here
    # rather than report a clean plan that leaves the bucket (and the hostname) behind.
    $r2Held = @($dns | Where-Object { $_.content -like "*r2.dev*" })
    if ($r2Held.Count -gt 0 -and $buckets.Count -eq 0) {
        $names = @($(if ($bucketList -and $bucketList.buckets) { $bucketList.buckets | ForEach-Object { $_.name } } else { @() }))
        Write-Bad "$(@($r2Held | ForEach-Object { $_.name }) -join ', ') is held by an R2 bucket this script did not identify. Buckets on the account: $(if ($names) { $names -join ', ' } else { '(none listed)' })"
    }

    foreach ($r in $routes) { Write-Item "Worker route   $($r.pattern) -> $($r.script)" }
    foreach ($d in $workerDomains) { Write-Item "Worker domain  $($d.hostname) -> $($d.service)" }
    foreach ($s in $scripts) { Write-Item "Worker         $($s.id)" }
    foreach ($p in $pages) { Write-Item "Pages project  $($p.name)  [domains: $(@($p.domains) -join ', ')] + all its deployments" }
    foreach ($b in $buckets) { Write-Item "R2 bucket      $($b.name)  [custom domains: $($b.domains -join ', ')] + every object in it" }
    foreach ($r in $dns) {
        # Records Cloudflare manages for an R2 custom domain or a Pages domain are read-only: they go
        # when their owner above goes, and the execute step re-reads before deleting what is left.
        $managed = if ($r.meta -and $r.meta.read_only) { "  (managed: removed with its bucket/project)" } else { "" }
        Write-Item "DNS record     $($r.type) $($r.name) -> $($r.content)$managed"
    }
    if ($dnsRefused) { Write-Host "   NOTE   the NEW staging's edge already exists: legacy DNS records are left alone (they may be the new ones)." -ForegroundColor Yellow }
    if (($routes.Count + $workerDomains.Count + $scripts.Count + $pages.Count + $buckets.Count + $dns.Count) -eq 0 -and -not $ruleset) { Write-None }

    # Build settings of a legacy Pages project: anything set by hand there may belong in pages_build_env.
    if ($t.legacy) {
        foreach ($p in $pages) {
            Write-Host "   build settings of $($p.name): command '$($p.build_config.build_command)', output '$($p.build_config.destination_dir)', root '$($p.build_config.root_dir)'" -ForegroundColor DarkGray
            $vars = $p.deployment_configs.production.env_vars
            if ($vars) {
                foreach ($v in $vars.PSObject.Properties) {
                    $shown = if ($v.Value.type -eq "secret_text") { "<secret>" } else { $v.Value.value }
                    Write-Host "     env $($v.Name) = $shown" -ForegroundColor DarkGray
                }
            }
        }
    }

    # R2 keys to empty the bucket(s), from the target project's own Secret Manager.
    if ($buckets.Count -gt 0) {
        $env:OZ_R2_ENDPOINT = "https://$a.r2.cloudflarestorage.com"
        if ($gcpState -eq "ACTIVE") {
            $env:OZ_R2_ACCESS_KEY = Get-OldSecret "ozari-r2-access-key"
            $env:OZ_R2_SECRET_KEY = Get-OldSecret "ozari-r2-secret-key"
        }
        $haveR2Keys = ($env:OZ_R2_ACCESS_KEY -and $env:OZ_R2_SECRET_KEY)
        foreach ($b in $buckets) {
            if (-not $haveR2Keys) { Write-Host "   NOTE   no R2 keys available to empty $($b.name); if it holds objects, empty it in the dashboard." -ForegroundColor Yellow; continue }
            $env:OZ_R2_BUCKET = $b.name
            $count = & node (Join-Path $PSScriptRoot "r2-empty.mjs") count
            if ($LASTEXITCODE -eq 0) { Write-Host "   $($b.name) holds $count" -ForegroundColor DarkGray }
            else { Write-Host "   NOTE   the stored R2 keys cannot read $($b.name); if it holds objects, empty it in the dashboard." -ForegroundColor Yellow }
        }
    }

    # --- Neon ------------------------------------------------------------------------------------------
    Write-Step "Neon (organization $orgId)"
    $neonProject = $null
    $neonJson = Invoke-OzNeonCtl @("projects", "list", "--org-id", $orgId, "--output", "json") -AllowFailure
    if (-not $neonJson) {
        Write-Bad "the Neon key cannot list projects in $orgId (re-run ./infrastructure/scripts/account.ps1 to diagnose)"
    } else {
        $neonList = $neonJson | ConvertFrom-Json
        $neonProjects = @(if ($neonList.PSObject.Properties["projects"]) { $neonList.projects } else { $neonList })
        $neonProject = $neonProjects | Where-Object { $_.name -eq $t.neon_project } | Select-Object -First 1
    }
    if ($neonProject) { Write-Item "Neon project   $($neonProject.name) ($($neonProject.id), $($neonProject.region_id), Postgres $($neonProject.pg_version)) - its database, branches and roles" }
    else { Write-None }

    # --- Google Cloud ----------------------------------------------------------------------------------
    Write-Step "Google Cloud"
    if ($gcpState -eq "ACTIVE") { Write-Item "GCP project    $($t.gcp_project) - Cloud Run, images, secrets, trigger, GitHub connection, state (recoverable 30 days)" }
    elseif ($gcpState -eq "DELETE_REQUESTED") { Write-Host "   already deleted (recoverable until Google purges it)" -ForegroundColor DarkGray }
    else { Write-None }
    $adcPath = Join-Path $env:APPDATA "gcloud\application_default_credentials.json"
    $adcQuota = ""
    if (Test-Path $adcPath) {
        $adc = [IO.File]::ReadAllText($adcPath) | ConvertFrom-Json
        if ($adc.PSObject.Properties["quota_project_id"]) { $adcQuota = $adc.quota_project_id }
    }
    $configProject = (Invoke-Gcloud @("config", "get-value", "project") -Quiet).Out
    $switchAdc = ($gcpState -eq "ACTIVE" -and $adcQuota -eq $t.gcp_project)
    $switchConfig = ($gcpState -eq "ACTIVE" -and $configProject -eq $t.gcp_project)
    if ($switchAdc -or $switchConfig) {
        if ($survivorState -ne "ACTIVE") {
            Write-Bad "gcloud still points at $($t.gcp_project) and $($t.survivor) does not exist yet - run the bootstrap of the surviving environment first"
        } else {
            if ($switchAdc) { Write-Host "   first: ADC quota project $($t.gcp_project) -> $($t.survivor)" -ForegroundColor Yellow }
            if ($switchConfig) { Write-Host "   first: gcloud default project $($t.gcp_project) -> $($t.survivor)" -ForegroundColor Yellow }
        }
    }

    # ===================================================================================== DRY RUN ENDS
    if (-not $Execute) {
        Write-Host ""
        if ($failures.Count -gt 0) {
            Write-Host "Dry run found $($failures.Count) blocker(s) - see FAIL above. Nothing was changed." -ForegroundColor Red
            exit 1
        }
        Write-Host "Dry run complete. Nothing was changed. To do exactly the above:" -ForegroundColor Cyan
        Write-Host "  ./infrastructure/scripts/retire.ps1 $Target -Execute"
        Write-Host ""
        return
    }
    if ($failures.Count -gt 0) { throw "Blockers found (FAIL above); nothing was deleted." }

    Write-Host ""
    Write-Host "This PERMANENTLY deletes everything marked above (the GCP project stays recoverable for 30 days)." -ForegroundColor Red
    $typed = Read-Host "Type '$Target' to proceed"
    if ($typed -ne $Target) { Write-Host "Not confirmed. Nothing was changed."; return }

    # ===================================================================================== EXECUTE
    # 1. Harvest first: the source disappears with the project.
    if ($harvest.Count -gt 0) {
        Write-Step "Carrying values into secrets/$($t.harvest_into).json"
        $envData = Read-OzSecrets $t.harvest_into
        foreach ($key in $harvest.Keys) {
            Set-OzValue -Data $envData -Scope $t.harvest_into -Key $key -Value $harvest[$key] | Out-Null
            Write-Ok "$key"
        }
        Save-OzSecrets -Scope $t.harvest_into -Data $envData
        $harvest.Clear()
    }

    # 2. Cloudflare, outermost first.
    Write-Step "Cloudflare"
    foreach ($r in $routes) {
        $x = Invoke-Cf "Delete" "zones/$z/workers/routes/$($r.id)"
        if ($x.Ok) { Write-Ok "route $($r.pattern)" } else { Write-Bad "route $($r.pattern): $($x.Error)" }
    }
    foreach ($d in $workerDomains) {
        $x = Invoke-Cf "Delete" "accounts/$a/workers/domains/$($d.id)"
        if ($x.Ok) { Write-Ok "worker domain $($d.hostname)" } else { Write-Bad "worker domain $($d.hostname): $($x.Error)" }
    }
    foreach ($s in $scripts) {
        $x = Invoke-Cf "Delete" "accounts/$a/workers/scripts/$($s.id)?force=true"
        if ($x.Ok) { Write-Ok "worker $($s.id)" } else { Write-Bad "worker $($s.id): $($x.Error)" }
    }
    foreach ($p in $pages) {
        foreach ($d in @($p.domains)) {
            # <name>.pages.dev is the project's own address, not a custom domain: it goes with the project.
            if (-not $d -or $d -like "*.pages.dev") { continue }
            $x = Invoke-Cf "Delete" "accounts/$a/pages/projects/$($p.name)/domains/$d"
            if ($x.Ok) { Write-Ok "pages domain $d" } else { Write-Bad "pages domain $d`: $($x.Error)" }
        }
        # A project with many deployments cannot be deleted directly; remove them first. The live
        # production deployment refuses deletion; the project delete takes it.
        $removed = 0
        for ($pass = 0; $pass -lt 200; $pass++) {
            $page = Invoke-Cf "Get" "accounts/$a/pages/projects/$($p.name)/deployments?per_page=25"
            if (-not $page.Ok) { $page = Invoke-Cf "Get" "accounts/$a/pages/projects/$($p.name)/deployments" }
            $deps = @($page.Result | Where-Object { $_ })
            $progress = 0
            foreach ($dep in $deps) {
                if ((Invoke-Cf "Delete" "accounts/$a/pages/projects/$($p.name)/deployments/$($dep.id)?force=true").Ok) { $progress++ }
            }
            $removed += $progress
            if ($progress -eq 0) { break }
        }
        Write-Ok "pages $($p.name): $removed deployment(s) removed"
        $x = Invoke-Cf "Delete" "accounts/$a/pages/projects/$($p.name)"
        if ($x.Ok) { Write-Ok "pages project $($p.name)" } else { Write-Bad "pages project $($p.name): $($x.Error)" }
    }
    foreach ($b in $buckets) {
        foreach ($d in $b.domains) {
            $x = Invoke-Cf "Delete" "accounts/$a/r2/buckets/$($b.name)/domains/custom/$d"
            if ($x.Ok) { Write-Ok "r2 custom domain $d" } else { Write-Bad "r2 custom domain $d`: $($x.Error)" }
        }
        if ($env:OZ_R2_ACCESS_KEY -and $env:OZ_R2_SECRET_KEY) {
            $env:OZ_R2_BUCKET = $b.name
            $out = & node (Join-Path $PSScriptRoot "r2-empty.mjs") empty
            if ($LASTEXITCODE -eq 0) { Write-Ok "r2 $($b.name): $out" } else { Write-Bad "r2 $($b.name): could not empty it with the stored keys" }
        }
        $x = Invoke-Cf "Delete" "accounts/$a/r2/buckets/$($b.name)"
        if ($x.Ok) { Write-Ok "r2 bucket $($b.name)" } else { Write-Bad "r2 bucket $($b.name): $($x.Error)" }
    }
    if ($ruleset) {
        $x = Invoke-Cf "Delete" "zones/$z/rulesets/$($ruleset.id)"
        if ($x.Ok) { Write-Ok "zone ruleset $($ruleset.name)" } else { Write-Bad "zone ruleset $($ruleset.name): $($x.Error)" }
    }
    # DNS last: Pages and R2 own some of these records and removed them above. Re-read, delete the rest.
    if (-not $dnsRefused) {
        foreach ($h in $t.hosts) {
            foreach ($r in @((Invoke-Cf "Get" "zones/$z/dns_records?name=$h").Result | Where-Object { $_ -and $dnsTypes -contains $_.type })) {
                if ($r.meta -and $r.meta.read_only) {
                    # Managed by an R2/Pages custom domain removed above; Cloudflare takes it away itself,
                    # a few seconds later. Wait for that instead of deleting (which it refuses).
                    $gone = $false
                    for ($i = 0; $i -lt 12 -and -not $gone; $i++) {
                        Start-Sleep -Seconds 5
                        $gone = -not ((Invoke-Cf "Get" "zones/$z/dns_records/$($r.id)").Ok)
                    }
                    if ($gone) { Write-Ok "dns $($r.type) $($r.name) (removed with its owner)" }
                    else { Write-Bad "dns $($r.type) $($r.name): still managed by a custom domain after 60s; re-run in a minute" }
                    continue
                }
                $x = Invoke-Cf "Delete" "zones/$z/dns_records/$($r.id)"
                if ($x.Ok) { Write-Ok "dns $($r.type) $($r.name)" } else { Write-Bad "dns $($r.type) $($r.name): $($x.Error)" }
            }
        }
    }

    # 3. Neon.
    Write-Step "Neon"
    if ($neonProject) {
        try {
            Invoke-OzNeonCtl @("projects", "delete", $neonProject.id) | Out-Null
            Write-Ok "project $($neonProject.name) ($($neonProject.id))"
        } catch {
            Write-Bad "project $($neonProject.name): the Neon CLI refused (its message is above)"
        }
    } else { Write-Host "   (nothing)" -ForegroundColor DarkGray }

    # 4. Google Cloud, last.
    Write-Step "Google Cloud"
    if ($gcpState -ne "ACTIVE") {
        Write-Host "   (nothing)" -ForegroundColor DarkGray
    } elseif ($failures.Count -gt 0) {
        Write-Bad "project $($t.gcp_project) NOT deleted: something above failed, and this project still holds what a re-run needs. Fix, then re-run."
    } else {
        if ($switchAdc) {
            $r = Invoke-Gcloud @("auth", "application-default", "set-quota-project", $t.survivor) -Quiet
            if ($r.Code -eq 0) { Write-Ok "ADC quota project -> $($t.survivor)" } else { Write-Bad "could not switch the ADC quota project; run: gcloud auth application-default set-quota-project $($t.survivor)" }
        }
        if ($switchConfig) {
            $r = Invoke-Gcloud @("config", "set", "project", $t.survivor) -Quiet
            if ($r.Code -eq 0) { Write-Ok "gcloud default project -> $($t.survivor)" } else { Write-Bad "could not switch the gcloud default project" }
        }
        if ($failures.Count -eq 0) {
            $r = Invoke-Gcloud @("projects", "delete", $t.gcp_project, "--quiet")
            if ($r.Code -eq 0) { Write-Ok "project $($t.gcp_project) deleted (gcloud projects undelete $($t.gcp_project) within 30 days)" }
            else { Write-Bad "project $($t.gcp_project): gcloud refused (message above)" }
        }
    }

    Write-Host ""
    if ($failures.Count -eq 0) {
        Write-Host "'$Target' is retired." -ForegroundColor Green
    } else {
        Write-Host "$($failures.Count) step(s) failed - see FAIL above. Fix and re-run: finished steps are skipped." -ForegroundColor Red
        exit 1
    }
} finally {
    Clear-OzProcessSecrets
    foreach ($n in @("OZ_R2_ENDPOINT", "OZ_R2_ACCESS_KEY", "OZ_R2_SECRET_KEY", "OZ_R2_BUCKET")) {
        if (Test-Path "Env:$n") { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
    }
}
