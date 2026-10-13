# =============================================================================
# Ozari — the database, end to end: Neon project → migrator + app roles → verified → saved.
#
#   ./infrastructure/scripts/neon.ps1 staging                            # create or reuse, then verify
#   ./infrastructure/scripts/neon.ps1 staging -RotateAppPassword         # new password for the API's role
#   ./infrastructure/scripts/neon.ps1 staging -RotateMigratorPassword    # new password for the pipeline's
#   ./infrastructure/scripts/neon.ps1 staging -VerifyOnly                # change nothing, prove it is right
#   ... -RotateAppPassword -RotateMigratorPassword -DropConnections      # incident: also cut every open session
#
# THREE LOGINS (the full reasoning is at the top of db-bootstrap.mjs):
#   neondb_owner    the DBA — you, in pgAdmin. Its URL is fetched from Neon for each run and NEVER
#                   saved: not in secrets/, not in Secret Manager, not in the pipeline.
#   ozari_migrator  owns the schema: `prisma migrate deploy` (Cloud Build) and db-seed.ps1.
#                   No server powers.                                → direct_database_url (DIRECT)
#   ozari_api       the API: read/write data, never change the schema. → database_url (POOLED)
#
# What it does:
#   1. Finds the Neon project named in envs/<env>/environment.json, or CREATES it there (region,
#      Postgres version and autoscaling range from the same file) through the Neon CLI.
#   2. Gets the owner's connection string from Neon (in memory only).
#   3. Creates / rotates both roles with SQL — db-bootstrap.mjs — and runs the verification, which
#      FAILS the script if either role holds more than its job needs. Nothing is saved on a failure.
#   4. Saves the two connection strings. A changed value bumps its rotation counter, so the next
#      `tf.ps1 <env> gcp apply` pushes it to Secret Manager.
#
# Nothing secret is ever printed. Needs: secrets/account.json → neon_org_id + neon_api_key, and
# `pnpm install` done in ozari-api (for `pg`).
#
# ⚠️ Rotating a password takes effect in the DATABASE immediately; Secret Manager catches up at the next
# gcp apply. Run that apply right after a rotation (until then the old password no longer works).
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("staging", "prod")]
    [string]$Environment,

    [switch]$RotateAppPassword,
    [switch]$RotateMigratorPassword,
    [switch]$VerifyOnly,

    # Postgres checks a password only when a connection OPENS: a session someone already holds survives
    # a password change. This restarts the project's running computes after the rotation, which closes
    # every connection — an attacker's included (and the API's, which is rolling anyway).
    [switch]$DropConnections,

    [string]$AppRole = "ozari_api",
    [string]$MigratorRole = "ozari_migrator"
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

$envConfig = Get-OzEnvironment $Environment
$neon = $envConfig.neon

function ConvertTo-NormalizedUrl {
    # Keep the exact URL shape the API has always run with: postgresql://…?sslmode=require.
    # Neon now appends channel_binding=require, which Prisma's migration engine does not understand.
    param([string]$Url)
    $base, $query = $Url -split '\?', 2
    $params = [ordered]@{}
    if ($query) {
        foreach ($pair in $query -split '&') {
            $k, $v = $pair -split '=', 2
            if ($k -and $k -ne "channel_binding") { $params[$k] = $v }
        }
    }
    $params["sslmode"] = "require"
    $base = $base -replace '^postgres://', 'postgresql://'
    # "$($base)?" and not "$base?": in PowerShell `?` is a legal variable-name character.
    return "$($base)?" + (($params.Keys | ForEach-Object { "$_=$($params[$_])" }) -join '&')
}

function Get-UrlUser([string]$Url) {
    # user and password of a stored connection string; "" when there is none.
    if ($Url -notmatch '^postgres(ql)?://') { return @("", "") }
    $info = ([System.Uri]$Url).UserInfo
    $user, $pass = $info -split ':', 2
    return @([Uri]::UnescapeDataString($user), [Uri]::UnescapeDataString([string]$pass))
}

$roleEnv = @("OZ_OWNER_URL", "OZ_MIGRATOR_ROLE", "OZ_MIGRATOR_PASSWORD", "OZ_SET_MIGRATOR_PASSWORD",
    "OZ_APP_ROLE", "OZ_APP_PASSWORD", "OZ_VERIFY_ONLY")

if ($DropConnections -and $VerifyOnly) { throw "-DropConnections changes the database; it cannot be combined with -VerifyOnly." }

try {
    $acct = Import-OzAccount -Require @("neon_api_key", "neon_org_id")
    # Every Neon project belongs to an organization. Naming it explicitly means a CLI run can never
    # list (and miss) or create in some other org the key happens to reach.
    $orgId = Get-OzValue $acct "account" "neon_org_id"
    $data = Read-OzSecrets $Environment

    # --- 1. The project ---------------------------------------------------------
    $listJson = Invoke-OzNeonCtl @("projects", "list", "--org-id", $orgId, "--output", "json") | ConvertFrom-Json
    $projects = @(if ($listJson.PSObject.Properties["projects"]) { $listJson.projects } else { $listJson })
    $project = $projects | Where-Object { $_.name -eq $neon.project_name } | Select-Object -First 1

    $ownerUrl = ""
    if (-not $project) {
        if ($VerifyOnly) { throw "Neon project '$($neon.project_name)' does not exist; nothing to verify." }
        Write-Host "Creating Neon project '$($neon.project_name)' in $($neon.region_id) (Postgres $($neon.pg_version), $($neon.compute_units) CU) ..." -ForegroundColor Cyan
        $created = Invoke-OzNeonCtl @(
            "projects", "create",
            "--org-id", $orgId,
            "--name", $neon.project_name,
            "--region-id", $neon.region_id,
            "--pg-version", [string]$neon.pg_version,
            "--cu", $neon.compute_units,
            "--output", "json"
        ) | ConvertFrom-Json
        $projectId = $created.project.id
        $ownerUrl = $created.connection_uris[0].connection_uri
        Write-Host "Created project $projectId." -ForegroundColor Green
    } else {
        $projectId = $project.id
        Write-Host "Using existing Neon project '$($neon.project_name)' ($projectId, $($project.region_id))." -ForegroundColor Cyan
        if ($project.region_id -ne $neon.region_id) {
            Write-Warning "It lives in $($project.region_id), not $($neon.region_id) as environment.json says. Region cannot be changed; recreate the project if that matters."
        }
    }

    # --- 2. The owner, in memory only -------------------------------------------
    if ($ownerUrl -eq "") {
        # The owner role and database are Neon's defaults for a project created by this script. The
        # CLI's default is the DIRECT (unpooled) endpoint, which role management needs.
        $ownerUrl = (Invoke-OzNeonCtl @(
                "connection-string", "--project-id", $projectId,
                "--role-name", "neondb_owner", "--database-name", "neondb"
            )).Trim().Split("`n")[-1].Trim()
    }
    if ($ownerUrl -notmatch '^postgres(ql)?://') { throw "Could not obtain the owner connection string from Neon." }
    $ownerUrl = ConvertTo-NormalizedUrl $ownerUrl
    $owner = [System.Uri]$ownerUrl

    # --- 3. Roles: decide which passwords change --------------------------------
    $storedMigrator = Get-UrlUser (Get-OzValue $data $Environment "direct_database_url")
    $migratorPassword = ""
    $setMigrator = $false
    if ($storedMigrator[0] -eq $MigratorRole -and $storedMigrator[1] -ne "" -and -not $RotateMigratorPassword) {
        $migratorPassword = $storedMigrator[1]
    } elseif (-not $VerifyOnly) {
        # First run, an explicit rotation, or a stored URL that is not the migrator's (e.g. an older
        # setup that migrated as the owner): the migrator gets a fresh password.
        $migratorPassword = New-OzHexSecret 32
        $setMigrator = $true
    }

    $appPassword = ""
    $storedApp = Get-UrlUser (Get-OzValue $data $Environment "database_url")
    if (-not $VerifyOnly -and ($RotateAppPassword -or $storedApp[0] -ne $AppRole -or $storedApp[1] -eq "")) {
        $appPassword = New-OzHexSecret 32
    }

    $env:OZ_OWNER_URL = $ownerUrl
    $env:OZ_MIGRATOR_ROLE = $MigratorRole
    $env:OZ_APP_ROLE = $AppRole
    if ($migratorPassword) { $env:OZ_MIGRATOR_PASSWORD = $migratorPassword }
    $env:OZ_SET_MIGRATOR_PASSWORD = if ($setMigrator) { "1" } else { "0" }
    if ($appPassword) { $env:OZ_APP_PASSWORD = $appPassword } else { Remove-Item Env:OZ_APP_PASSWORD -ErrorAction SilentlyContinue }
    $env:OZ_VERIFY_ONLY = if ($VerifyOnly) { "1" } else { "0" }

    & node (Join-Path $PSScriptRoot "db-bootstrap.mjs")
    if ($LASTEXITCODE -ne 0) {
        throw "The roles did not pass (see above). Nothing was saved. If it says 'password authentication failed for user $MigratorRole', re-run with -RotateMigratorPassword."
    }

    # --- 4. Save the two connection strings -------------------------------------
    $database = $owner.AbsolutePath
    if ($setMigrator) {
        # DIRECT endpoint: migrations take advisory locks and run DDL, which a pooler does not carry.
        $migratorUrl = "postgresql://$($MigratorRole):$($migratorPassword)@$($owner.Host)$($database)?sslmode=require"
        if ((Set-OzValue -Data $data -Scope $Environment -Key "direct_database_url" -Value $migratorUrl)) {
            Write-Host "direct_database_url changed - rotation counter bumped; run the gcp apply next." -ForegroundColor Yellow
        }
    }
    if ($appPassword) {
        # Neon's pooled endpoint is the direct host with '-pooler' on the FIRST label.
        $labels = $owner.Host.Split(".")
        if (-not $labels[0].EndsWith("-pooler")) { $labels[0] = "$($labels[0])-pooler" }
        $appUrl = "postgresql://$($AppRole):$($appPassword)@$($labels -join '.')$($database)?sslmode=require"
        if ((Set-OzValue -Data $data -Scope $Environment -Key "database_url" -Value $appUrl)) {
            Write-Host "database_url changed - rotation counter bumped; run the gcp apply next." -ForegroundColor Yellow
        }
    }
    Save-OzSecrets -Scope $Environment -Data $data

    # --- 5. Optionally cut every open session ------------------------------------
    if ($DropConnections) {
        $api = "https://console.neon.tech/api/v2/projects/$projectId/endpoints"
        $neonHeaders = @{ Authorization = "Bearer $env:NEON_API_KEY"; Accept = "application/json" }
        $manual = "Neon console -> project '$($neon.project_name)' -> Branches -> the branch -> Computes -> Restart"
        try {
            $endpoints = @((Invoke-RestMethod -Uri $api -Headers $neonHeaders -Method Get).endpoints)
        } catch {
            $endpoints = @()
            Write-Warning "Could not list the computes ($($_.Exception.Message)). Restart them by hand: $manual"
        }
        foreach ($ep in $endpoints) {
            if (-not $ep) { continue }
            if ($ep.current_state -eq "idle") {
                Write-Host "Compute $($ep.id) is suspended: it holds no connections." -ForegroundColor DarkGray
                continue
            }
            try {
                Invoke-RestMethod -Uri "$api/$($ep.id)/restart" -Headers $neonHeaders -Method Post | Out-Null
                Write-Host "Compute $($ep.id) restarted: every open connection is closed." -ForegroundColor Green
            } catch {
                Write-Warning "Compute $($ep.id) did not restart ($($_.Exception.Message)). Do it by hand NOW: $manual"
            }
        }
    }

    Write-Host ""
    Write-Host "Neon for '$Environment' is ready. In $(Get-OzSecretsPath $Environment):" -ForegroundColor Green
    Write-Host "  direct_database_url  $MigratorRole, DIRECT - migrations (Cloud Build) and db-seed; never bound to Cloud Run"
    Write-Host "  database_url         $AppRole, POOLED - what the API runs as"
    Write-Host "  (neondb_owner - the DBA login for pgAdmin - is not stored anywhere: Neon console -> Connect.)"
    Write-Host ""
} finally {
    Clear-OzProcessSecrets
    foreach ($n in $roleEnv) { if (Test-Path "Env:$n") { Remove-Item "Env:$n" -ErrorAction SilentlyContinue } }
}
