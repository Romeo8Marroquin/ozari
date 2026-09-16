# =============================================================================
# Ozari — create (or rotate) the least-privileged application database role.
#
#   ./db-bootstrap.ps1 -DirectUrl "postgresql://owner:pw@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
#
# What it does:
#   1. generates a strong password locally (nothing is fetched, nothing is uploaded),
#   2. runs db-roles.sql as the OWNER to create/rotate the role and its grants,
#   3. runs db-verify.sql, which FAILS the script if the role can do DDL,
#   4. prints the pooled connection string to paste into secrets.auto.tfvars.
#
# ⚠️ It prints a password to your terminal, on purpose — that is the only copy, and it is never
# written to disk by this script. Paste it into the environment's gitignored `secrets.auto.tfvars`,
# then clear your scrollback. It is not emailed, logged or committed anywhere.
#
# Needs `psql`. If it is not on PATH the script falls back to running it in Docker, so there is
# nothing to install on Windows.
# =============================================================================
[CmdletBinding()]
param(
    # The OWNER (direct, non-pooled) connection string. Take it from the Neon dashboard.
    [Parameter(Mandatory = $true)]
    [string]$DirectUrl,

    [string]$AppRole = "ozari_api",

    # Override only if Neon changes its pooled-host convention.
    [string]$PoolerHost = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot

# --- Parse the owner URL -----------------------------------------------------
try {
    $uri = [System.Uri]$DirectUrl
} catch {
    throw "DirectUrl is not a valid URI. Expected postgresql://user:password@host/dbname?sslmode=require"
}
if ($uri.Scheme -notin @("postgres", "postgresql")) {
    throw "DirectUrl must use the postgres:// or postgresql:// scheme (got '$($uri.Scheme)')."
}

$DbName = $uri.AbsolutePath.TrimStart("/")
if ([string]::IsNullOrWhiteSpace($DbName)) { throw "DirectUrl has no database name." }

# Neon's pooled endpoint is the direct host with '-pooler' appended to the FIRST label.
if ([string]::IsNullOrWhiteSpace($PoolerHost)) {
    $hostParts = $uri.Host.Split(".")
    $hostParts[0] = "$($hostParts[0])-pooler"
    $PoolerHost = ($hostParts -join ".")
}

# --- Generate the password ---------------------------------------------------
# 32 bytes as hex: 256 bits of entropy, and every character is URL-safe — which matters because this
# ends up inside a connection string. A base64 password containing '+' or '/' silently corrupts the
# URL and presents as an authentication failure with a correct password.
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$AppPassword = -join ($bytes | ForEach-Object { $_.ToString("x2") })

# --- Locate psql -------------------------------------------------------------
$psqlLocal = Get-Command psql -ErrorAction SilentlyContinue
$useDocker = $false
if (-not $psqlLocal) {
    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCmd) {
        throw "Neither psql nor docker is available. Install the PostgreSQL client, or Docker Desktop."
    }
    $useDocker = $true
    Write-Host "psql not found on PATH — running it in Docker (postgres:17-alpine)."
}

function Invoke-Psql {
    # $FileName is the bare file name; the path differs between the local and Docker cases, so it is
    # built per mode rather than string-replaced after the fact.
    param([string]$FileName, [string[]]$Vars)

    $psqlArgs = @("-v", "ON_ERROR_STOP=1")
    foreach ($v in $Vars) { $psqlArgs += @("-v", $v) }

    if ($useDocker) {
        # The SQL directory is mounted read-only, and the connection string travels as an env var so
        # it never lands in `docker ps` output or in a container's argv.
        $env:PGURL = $DirectUrl
        $dockerArgs = @(
            "run", "--rm",
            "-e", "PGURL",
            "-v", "$($ScriptDir):/sql:ro",
            "postgres:17-alpine",
            "sh", "-c",
            "psql `"`$PGURL`" $($psqlArgs -join ' ') -f /sql/$FileName"
        )
        & docker @dockerArgs
    } else {
        & psql $DirectUrl @psqlArgs -f (Join-Path $ScriptDir $FileName)
    }

    if ($LASTEXITCODE -ne 0) { throw "psql failed on $FileName (exit $LASTEXITCODE)." }
}

# --- 1. Create / rotate the role --------------------------------------------
Write-Host ""
Write-Host "Configuring role '$AppRole' on database '$DbName' ..."
Invoke-Psql -FileName "db-roles.sql" -Vars @(
    "app_role=$AppRole",
    "app_password=$AppPassword",
    "db_name=$DbName"
)

# --- 2. Prove it is actually least-privileged --------------------------------
Write-Host ""
Write-Host "Verifying privileges ..."
Invoke-Psql -FileName "db-verify.sql" -Vars @("app_role=$AppRole")

# --- 3. Hand back the connection strings -------------------------------------
$pooled = "postgresql://$($AppRole):$($AppPassword)@$($PoolerHost)$($uri.AbsolutePath)?sslmode=require"

Write-Host ""
Write-Host "============================================================"
Write-Host " Paste into the environment's secrets.auto.tfvars (GITIGNORED)"
Write-Host "============================================================"
Write-Host ""
Write-Host "  database_url        = `"$pooled`""
Write-Host "  direct_database_url = `"<the owner URL you passed in>`""
Write-Host ""
Write-Host "Then bump both keys in secret_version_triggers and run the apply wrapper."
Write-Host ""
Write-Host "Reminders:"
Write-Host "  · database_url is POOLED (-pooler) and least-privileged — it is what the API runs as."
Write-Host "  · direct_database_url is the OWNER and is bound ONLY to the migration step, never to"
Write-Host "    the running service."
Write-Host "  · Clear this terminal's scrollback: the password above is the only copy."
Write-Host ""

if ($env:PGURL) { Remove-Item Env:\PGURL -ErrorAction SilentlyContinue }
