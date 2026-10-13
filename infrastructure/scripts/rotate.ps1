# =============================================================================
# Ozari — EMERGENCY ROTATION: replace an environment's credentials in one guided run.
#
#   ./infrastructure/scripts/rotate.ps1 staging                       # everything below (incident default)
#   ./infrastructure/scripts/rotate.ps1 prod -Only database,sessions  # just those
#
# The runbook around it — what to do BEFORE and AFTER, and when — is INCIDENTS.md. Practise it on
# staging: a rotation script that has never run is not a plan.
#
#   group      what changes                                  what a user notices
#   account    Cloudflare token + Neon key (shared by BOTH   nothing
#              environments; they live only on this machine)
#   email      Resend key                                    emails fail until the run ends (minutes)
#   r2         R2 key pair                                   photo uploads fail until the run ends
#   google     Calendar OAuth client SECRET (the client id   calendar sync pauses until the run ends;
#              stays, so connected calendars stay connected)  nobody reconnects
#   github     Cloud Build's GitHub token                    nothing (deploys only)
#   sessions   both JWT signing keys                         EVERYONE is signed out once
#   api_key    the server-to-server API key                  nothing (browsers do not use it)
#   database   both database passwords + every open          the API errors for ~1-3 minutes, from the
#              database session is cut                       password change until the new revision is up
#
# ORDER. Dashboard keys are revoked FIRST and replaced second: in an incident a leaked key must stop
# working now, not after a deploy. The database goes LAST, right before the apply, so the window in
# which the API cannot reach it is as short as possible. One gcp apply then pushes every new value
# AND rolls a fresh Cloud Run revision (modules/gcp-env/secrets.tf, `runtime_secrets_generation`), so
# no instance keeps serving with an old value. Finally the script proves the API answers with the NEW
# api_key and the NEW database password.
#
# NOT rotated, on purpose: encryption_key. Replacing it makes every encrypted column unreadable; a
# leak of it is handled in INCIDENTS.md. Nothing secret is ever printed.
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("staging", "prod")]
    [string]$Environment,

    [ValidateSet("account", "email", "r2", "google", "github", "sessions", "api_key", "database")]
    [string[]]$Only = @()
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

$all = @("account", "email", "r2", "google", "github", "sessions", "api_key", "database")
$selected = if ($Only.Count -gt 0) { @($all | Where-Object { $Only -contains $_ }) } else { $all }

$envConfig = Get-OzEnvironment $Environment
$target = Get-OzTarget $Environment
# hosts[0] is the API's hostname in Get-OzTarget's table, for every environment.
$apiHost = $target.hosts[0]
$bucket = $target.buckets[0]
$project = $envConfig.project_id

# What to click, per dashboard key: revoke the old one, then create its replacement.
$steps = [ordered]@{
    cloudflare_api_token = @(
        "dash.cloudflare.com -> profile icon -> My Profile -> API Tokens -> ozari-terraform-local -> ... -> Roll.",
        "Rolling keeps its permissions and kills the old value at once. Copy the new value.")
    neon_api_key = @(
        "console.neon.tech -> Organization settings -> API keys -> Revoke the current key.",
        "Then Create new API key (an ORGANIZATION key) and copy it.")
    email_key = @(
        "resend.com -> API Keys -> delete the key used by $Environment.",
        "Then Create API Key: name ozari-$Environment, permission Sending access, domain partyrentalsgt.com. Copy it (re_...).")
    r2_access_key = @(
        "dash.cloudflare.com -> R2 Object Storage -> Manage API tokens -> delete ozari-$Environment-assets.",
        "Then Create Account API token: name ozari-$Environment-assets, Object Read & Write, only bucket $bucket, TTL Forever.",
        "Copy the Access Key ID now (the Secret Access Key is asked next; ignore the cfat_ token value).")
    r2_secret_key = @("The Secret Access Key from the same page.")
    google_client_secret = @(
        "console.cloud.google.com -> project $project -> Google Auth Platform -> Clients -> Ozari Google Calendar ($Environment).",
        "Add secret -> copy the new secret. Then on the OLD secret: Disable, then Delete.",
        "The client id does not change, so connected calendars stay connected.")
    github_oauth_token = @(
        "github.com -> Settings -> Developer settings -> Tokens (classic) -> delete 'ozari cloud-build $Environment'.",
        "Then Generate new token (classic): same name, ~1 year, scopes repo + read:user. Copy it (ghp_...).")
}

$groupKeys = @{
    account = @("cloudflare_api_token", "neon_api_key")
    email = @("email_key")
    r2 = @("r2_access_key", "r2_secret_key")
    google = @("google_client_secret")
    github = @("github_oauth_token")
}

function Write-Step([string]$Text) { Write-Host ""; Write-Host "== $Text" -ForegroundColor Cyan }

function Get-Current([string]$Scope, [string]$Key) {
    # In memory only, to tell whether a prompt actually replaced the value. Never printed.
    return Get-OzValue (Read-OzSecrets $Scope) $Scope $Key
}

function Update-ClickedKey([string]$Scope, [string]$Key) {
    Write-Host ""
    foreach ($line in $steps[$Key]) { Write-Host "   $line" }
    $before = Get-Current $Scope $Key
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            & (Join-Path $PSScriptRoot "secret.ps1") $Scope $Key
            break
        } catch {
            Write-Warning $_.Exception.Message
            if ($attempt -eq 3) { break }
        }
    }
    $changed = (Get-Current $Scope $Key) -ne $before
    if (-not $changed) { Write-Warning "$Scope/$Key was NOT replaced." }
    return $changed
}

$replaced = New-Object System.Collections.ArrayList
$notReplaced = New-Object System.Collections.ArrayList

try {
    # --- 0. Confirm ------------------------------------------------------------
    Write-Host ""
    Write-Host "EMERGENCY ROTATION for '$Environment' ($project)" -ForegroundColor Yellow
    Write-Host "Groups: $($selected -join ', ')"
    if ($selected -contains "sessions") { Write-Host "  sessions -> EVERYONE is signed out once." -ForegroundColor Yellow }
    if ($selected -contains "database") { Write-Host "  database -> the API errors for ~1-3 minutes near the end of the run." -ForegroundColor Yellow }
    if ($selected -contains "account") { Write-Host "  account  -> the Cloudflare token and Neon key are SHARED by staging and prod." -ForegroundColor Yellow }
    Write-Host "Keep this window open until it says DONE. encryption_key is never rotated here (INCIDENTS.md)."
    if ($Environment -eq "prod") { Write-Host "This is PRODUCTION." -ForegroundColor Red }
    $confirm = Read-Host "Type the environment name ($Environment) to start"
    if ($confirm -ne $Environment) { throw "Confirmation did not match. Nothing was changed." }

    # --- 1. Account credentials (local only; the rest of the run needs them) ----
    if ($selected -contains "account") {
        Write-Step "Account credentials (shared by both environments)"
        foreach ($k in $groupKeys["account"]) {
            if (Update-ClickedKey "account" $k) { [void]$replaced.Add("account/$k") } else { [void]$notReplaced.Add("account/$k") }
        }
        Import-OzAccount -Require @("cloudflare_api_token", "neon_api_key", "neon_org_id") | Out-Null
        try {
            $verify = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/user/tokens/verify" -Headers @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" }
            if ($verify.result.status -ne "active") { throw "status $($verify.result.status)" }
            Write-Host "   Cloudflare token: active." -ForegroundColor Green
        } catch { throw "Cloudflare does not accept the token in account.json ($($_.Exception.Message)). Fix it: secret.ps1 account cloudflare_api_token" }
        $orgId = Get-OzValue (Read-OzSecrets "account") "account" "neon_org_id"
        if ($null -eq (Invoke-OzNeonCtl @("projects", "list", "--org-id", $orgId, "--output", "json") -AllowFailure)) {
            throw "Neon does not accept the key in account.json. Fix it: secret.ps1 account neon_api_key"
        }
        Write-Host "   Neon key: accepted." -ForegroundColor Green
        Clear-OzProcessSecrets
    }

    # --- 2. Dashboard keys of this environment ----------------------------------
    foreach ($group in @("email", "r2", "google", "github")) {
        if ($selected -notcontains $group) { continue }
        Write-Step "$group ($Environment)"
        foreach ($k in $groupKeys[$group]) {
            if (Update-ClickedKey $Environment $k) { [void]$replaced.Add("$Environment/$k") } else { [void]$notReplaced.Add("$Environment/$k") }
        }
    }

    # --- 3. Generated secrets ---------------------------------------------------
    $generated = @()
    if ($selected -contains "sessions") { $generated += @("jwt_secret", "jwt_refresh_secret") }
    if ($selected -contains "api_key") { $generated += "api_key" }
    if ($generated.Count -gt 0) {
        Write-Step "Generated secrets: $($generated -join ', ')"
        & (Join-Path $PSScriptRoot "new-secrets.ps1") $Environment -Rotate $generated
        foreach ($k in $generated) { [void]$replaced.Add("$Environment/$k") }
    }

    # --- 4. Database: last, so the outage window is as short as possible ---------
    if ($selected -contains "database") {
        Write-Step "Database passwords + cut every open session (the API errors from here until step 5 ends)"
        & (Join-Path $PSScriptRoot "neon.ps1") $Environment -RotateAppPassword -RotateMigratorPassword -DropConnections
        [void]$replaced.Add("$Environment/database_url")
        [void]$replaced.Add("$Environment/direct_database_url")
    }

    # --- 5. Push every new value and roll a fresh revision ----------------------
    $envChanged = @($replaced | Where-Object { $_ -like "$Environment/*" })
    if ($envChanged.Count -gt 0) {
        Write-Step "Push to Secret Manager + new Cloud Run revision (review the plan: only secret versions, the service and, for github, the connection change)"
        & (Join-Path $PSScriptRoot "tf.ps1") $Environment gcp plan
        & (Join-Path $PSScriptRoot "tf.ps1") $Environment gcp apply
    }

    # --- 6. Prove it: the API answers with the NEW api_key and NEW database password ---
    if ($envChanged.Count -gt 0) {
        Write-Step "Verify https://$apiHost/api/health/check"
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $apiKey = Get-Current $Environment "api_key"
        $status = 0
        for ($i = 1; $i -le 8 -and $status -ne 200; $i++) {
            try {
                $status = [int](Invoke-WebRequest -Uri "https://$apiHost/api/health/check" -Headers @{ "x-api-key" = $apiKey } -UseBasicParsing -TimeoutSec 30).StatusCode
            } catch {
                $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
                if ($status -ne 200) { Start-Sleep -Seconds 5 }
            }
        }
        $apiKey = $null
        if ($status -eq 200) {
            Write-Host "   200: the live revision accepts the new api_key and reaches the database with the new password." -ForegroundColor Green
        } else {
            Write-Warning "Health check answered $status. 401 = the old revision is still serving; 503 = it cannot reach the database. See INCIDENTS.md §2 -> 'If the final check fails'."
        }
    }

    # --- 7. Report ---------------------------------------------------------------
    Write-Host ""
    Write-Host "DONE - $(Get-Date -Format 'yyyy-MM-dd HH:mm') - '$Environment'" -ForegroundColor Green
    Write-Host "Replaced:     $(if ($replaced.Count) { $replaced -join ', ' } else { 'nothing' })"
    if ($notReplaced.Count -gt 0) {
        Write-Host "NOT replaced: $($notReplaced -join ', ')" -ForegroundColor Yellow
        Write-Host "  Finish them: ./infrastructure/scripts/rotate.ps1 $Environment -Only <group>" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Now:" -ForegroundColor Cyan
    Write-Host "  1. Upload the changed files in infrastructure/secrets/ to 1Password (the old copies are now useless)."
    Write-Host "  2. If ozari-api/.env points at this environment, copy the new values into it."
    Write-Host "  3. Finish the checklist in INCIDENTS.md §2 (logs, the DBA login, the incident note)."
    Write-Host ""
} catch {
    # A half-finished rotation must say exactly where it stopped: values already replaced in the
    # secrets file are live in NOTHING until the gcp apply runs.
    Write-Host ""
    Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Already replaced in infrastructure/secrets/: $(if ($replaced.Count) { $replaced -join ', ' } else { 'nothing' })" -ForegroundColor Yellow
    if (@($replaced | Where-Object { $_ -like "$Environment/*" }).Count -gt 0) {
        Write-Host "Push them as soon as the cause is fixed:" -ForegroundColor Yellow
        Write-Host "  ./infrastructure/scripts/tf.ps1 $Environment gcp plan" -ForegroundColor Yellow
        Write-Host "  ./infrastructure/scripts/tf.ps1 $Environment gcp apply" -ForegroundColor Yellow
    }
    Write-Host "Then rotate whatever is left: ./infrastructure/scripts/rotate.ps1 $Environment -Only <groups>" -ForegroundColor Yellow
    throw
} finally {
    Clear-OzProcessSecrets
}
