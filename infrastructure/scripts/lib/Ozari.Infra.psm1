# =============================================================================
# Ozari — shared helpers for the infrastructure scripts (Windows PowerShell 5.1 compatible).
#
# THE SECRETS LAYOUT. Every value that is secret or identifies an account lives in ONE gitignored
# directory, infrastructure/secrets/:
#
#   account.json   shared by every environment: billing account, Cloudflare ids + API token, Neon
#                  API key, the Cloud Build GitHub App installation id
#   staging.json   staging's secret values + rotation counters
#   prod.json      production's secret values + rotation counters
#
# That directory IS the recovery set: back it up (off this machine) and an environment can be
# re-applied from scratch. Templates with every key are in infrastructure/templates/.
#
# Values leave these files only as PROCESS environment variables for the command that needs them
# (CLOUDFLARE_API_TOKEN, NEON_API_KEY, TF_VAR_*). They are never printed, never passed on a command
# line (where other processes could read them), and never written into Terraform state.
# =============================================================================

Set-StrictMode -Version 2.0

$script:InfraRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:RepoRoot = Split-Path -Parent $script:InfraRoot
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-OzInfraRoot { $script:InfraRoot }
function Get-OzRepoRoot { $script:RepoRoot }

function Get-OzEnvironment {
    # The COMMITTED identity of an environment: project id, region, state bucket, Neon settings.
    param([Parameter(Mandatory = $true)][ValidateSet("staging", "prod")][string]$Name)

    $path = Join-Path $script:InfraRoot "terraform\envs\$Name\environment.json"
    if (-not (Test-Path $path)) { throw "Missing $path" }
    return [IO.File]::ReadAllText($path, $script:Utf8NoBom) | ConvertFrom-Json
}

function Get-OzSecretsPath {
    param([Parameter(Mandatory = $true)][ValidateSet("account", "staging", "prod")][string]$Scope)
    return Join-Path $script:InfraRoot "secrets\$Scope.json"
}

function Get-OzTemplate {
    param([Parameter(Mandatory = $true)][ValidateSet("account", "staging", "prod")][string]$Scope)
    $name = if ($Scope -eq "account") { "account.example.json" } else { "env.example.json" }
    $path = Join-Path $script:InfraRoot "templates\$name"
    return [IO.File]::ReadAllText($path, $script:Utf8NoBom) | ConvertFrom-Json
}

function Read-OzSecrets {
    # Returns the scope's file as an object, creating it from the template the first time. Keys added
    # to the template later are merged in empty, so an old file never silently lacks a new secret.
    param([Parameter(Mandatory = $true)][ValidateSet("account", "staging", "prod")][string]$Scope)

    $path = Get-OzSecretsPath $Scope
    $template = Get-OzTemplate $Scope

    if (-not (Test-Path $path)) {
        $dir = Split-Path -Parent $path
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
        Save-OzSecrets -Scope $Scope -Data $template
        Write-Host "Created $path from the template." -ForegroundColor DarkGray
        return $template
    }

    $data = [IO.File]::ReadAllText($path, $script:Utf8NoBom) | ConvertFrom-Json
    $changed = $false

    if ($Scope -eq "account") {
        foreach ($p in $template.PSObject.Properties) {
            if (-not $data.PSObject.Properties[$p.Name]) {
                $data | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value
                $changed = $true
            }
        }
    } else {
        foreach ($section in @("secrets", "rotation")) {
            if (-not $data.PSObject.Properties[$section]) {
                $data | Add-Member -NotePropertyName $section -NotePropertyValue ([pscustomobject]@{})
                $changed = $true
            }
        }
        foreach ($p in $template.secrets.PSObject.Properties) {
            if (-not $data.secrets.PSObject.Properties[$p.Name]) {
                $data.secrets | Add-Member -NotePropertyName $p.Name -NotePropertyValue ""
                $changed = $true
            }
        }
    }

    if ($changed) { Save-OzSecrets -Scope $Scope -Data $data }
    return $data
}

function Save-OzSecrets {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("account", "staging", "prod")][string]$Scope,
        [Parameter(Mandatory = $true)]$Data
    )
    $path = Get-OzSecretsPath $Scope
    $json = $Data | ConvertTo-Json -Depth 10
    # Write to a sibling temp file and move it over: a crash mid-write must never leave a truncated
    # file, because this file is the only copy of most of what is in it.
    $tmp = "$path.tmp"
    [IO.File]::WriteAllText($tmp, $json, $script:Utf8NoBom)
    Move-Item -Path $tmp -Destination $path -Force
}

function Get-OzSecretKeys {
    # The keys a scope is allowed to hold — the template is the contract, so a typo is an error
    # instead of a new, unused key.
    param([Parameter(Mandatory = $true)][ValidateSet("account", "staging", "prod")][string]$Scope)
    $template = Get-OzTemplate $Scope
    if ($Scope -eq "account") {
        return @($template.PSObject.Properties.Name | Where-Object { -not $_.StartsWith("_") })
    }
    return @($template.secrets.PSObject.Properties.Name)
}

function Get-OzValue {
    param([Parameter(Mandatory = $true)]$Data, [Parameter(Mandatory = $true)][string]$Scope, [Parameter(Mandatory = $true)][string]$Key)
    $holder = if ($Scope -eq "account") { $Data } else { $Data.secrets }
    $prop = $holder.PSObject.Properties[$Key]
    if ($prop) { return [string]$prop.Value }
    return ""
}

function Set-OzValue {
    # Sets one value in memory and, for an environment secret REPLACING an existing value, bumps that
    # key's rotation counter — without the bump Terraform cannot see the change (write-only values
    # leave nothing in state to compare against). Returns $true when it bumped.
    param(
        [Parameter(Mandatory = $true)]$Data,
        [Parameter(Mandatory = $true)][string]$Scope,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value
    )
    if ((Get-OzSecretKeys $Scope) -notcontains $Key) {
        throw "'$Key' is not a $Scope key. Valid keys: $((Get-OzSecretKeys $Scope) -join ', ')"
    }

    $holder = if ($Scope -eq "account") { $Data } else { $Data.secrets }
    $previous = [string]$holder.$Key
    $holder.$Key = $Value

    if ($Scope -ne "account" -and $previous -ne "" -and $previous -ne $Value) {
        $rot = $Data.rotation
        $current = 1
        if ($rot.PSObject.Properties[$Key]) { $current = [int]$rot.$Key }
        if ($rot.PSObject.Properties[$Key]) { $rot.$Key = $current + 1 }
        else { $rot | Add-Member -NotePropertyName $Key -NotePropertyValue ($current + 1) }
        return $true
    }
    return $false
}

function Get-OzMissing {
    param([Parameter(Mandatory = $true)]$Data, [Parameter(Mandatory = $true)][string]$Scope, [string[]]$Keys)
    if (-not $Keys) { $Keys = Get-OzSecretKeys $Scope }
    return @($Keys | Where-Object { (Get-OzValue $Data $Scope $_) -eq "" })
}

function Import-OzAccount {
    # Puts the account-level values into THIS process's environment. Terraform picks up TF_VAR_*
    # only for variables a root declares, so exporting all of them is harmless.
    param([string[]]$Require = @())

    $acct = Read-OzSecrets "account"
    # @(...): a function returning an EMPTY array returns $null, and this module runs under strict
    # mode, where $null.Count throws. Without it every script failed exactly when nothing was missing.
    $missing = @(Get-OzMissing $acct "account" $Require)
    if ($missing.Count -gt 0) {
        throw "infrastructure/secrets/account.json is missing: $($missing -join ', ').`nFill each with:  ./infrastructure/scripts/secret.ps1 account <key>"
    }

    $map = @{
        "billing_account"            = "TF_VAR_billing_account"
        "github_app_installation_id" = "TF_VAR_github_app_installation_id"
        "cloudflare_account_id"      = "TF_VAR_cloudflare_account_id"
        "cloudflare_zone_id"         = "TF_VAR_cloudflare_zone_id"
        "cloudflare_api_token"       = "CLOUDFLARE_API_TOKEN"
        "neon_api_key"               = "NEON_API_KEY"
    }
    foreach ($k in $map.Keys) {
        $v = Get-OzValue $acct "account" $k
        if ($v -ne "") { Set-Item -Path "Env:$($map[$k])" -Value $v }
    }
    return $acct
}

function Clear-OzProcessSecrets {
    # Belt and braces: the variables die with the process anyway, but a script dot-sourced into an
    # interactive session must not leave tokens behind in it.
    foreach ($name in @("CLOUDFLARE_API_TOKEN", "NEON_API_KEY", "TF_VAR_secret_values", "TF_VAR_secret_version_triggers",
            "TF_VAR_billing_account", "TF_VAR_github_app_installation_id", "TF_VAR_cloudflare_account_id",
            "TF_VAR_cloudflare_zone_id", "OZ_OWNER_URL", "OZ_APP_PASSWORD", "DATABASE_URL")) {
        if (Test-Path "Env:$name") { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    }
}

function New-OzHexSecret {
    # Hex is URL-safe, which matters: several of these end up inside connection strings, where a '+'
    # or '/' from base64 silently corrupts the URL and presents as a wrong password.
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return (-join ($buffer | ForEach-Object { $_.ToString("x2") }))
}

function Get-OzTarget {
    # Every name that identifies one environment OUTSIDE its Terraform code — what cf-inventory.ps1
    # recognises and what retire.ps1 deletes. ONE table, so the two can never disagree.
    # The Cloudflare names must match envs/<env>/cloudflare/main.tf.
    #
    #   legacy-staging   the pre-rebuild staging (project ozari-500103, Neon project "ozari", the
    #                    console-made Cloudflare objects). It holds the SAME hostnames as the new
    #                    staging, which is why it must be retired before the new edge is applied.
    param([Parameter(Mandatory = $true)][ValidateSet("staging", "prod", "legacy-staging")][string]$Name)

    $stagingHosts = @("api-staging.partyrentalsgt.com", "staging.partyrentalsgt.com", "assets-stg.partyrentalsgt.com")
    switch ($Name) {
        "staging" {
            $e = Get-OzEnvironment "staging"
            return @{
                name = "staging"; legacy = $false
                gcp_project = $e.project_id; neon_project = $e.neon.project_name; survivor = (Get-OzEnvironment "prod").project_id
                hosts = $stagingHosts
                workers = @("ozari-staging-api-proxy"); pages = @("ozari-staging"); buckets = @("ozari-staging-assets")
            }
        }
        "prod" {
            $e = Get-OzEnvironment "prod"
            return @{
                name = "prod"; legacy = $false
                gcp_project = $e.project_id; neon_project = $e.neon.project_name; survivor = (Get-OzEnvironment "staging").project_id
                hosts = @("api.partyrentalsgt.com", "partyrentalsgt.com", "assets.partyrentalsgt.com")
                workers = @("ozari-prod-api-proxy"); pages = @("ozari-prod"); buckets = @("ozari-prod-assets")
            }
        }
        "legacy-staging" {
            return @{
                name = "legacy-staging"; legacy = $true
                gcp_project = "ozari-500103"; neon_project = "ozari"; survivor = (Get-OzEnvironment "staging").project_id
                hosts = $stagingHosts
                # The real console-made names (confirmed 2026-10-12 by retire.ps1's dry run). Pages and R2
                # are ALSO matched by the hostnames they hold, since a project's name is not its address
                # (`ozari` serves ozari-c28.pages.dev).
                workers = @("api-staging-proxy"); pages = @("ozari"); buckets = @("ozari-staging")
                # Values worth carrying into the NEW staging instead of minting again: same environment,
                # same purpose, never exposed. secret id in the old project → key in secrets/staging.json.
                harvest_into = "staging"; harvest = @{ "ozari-email-key" = "email_key" }
                # Its replacement's Cloudflare names: while THESE exist, a hostname may belong to the
                # new staging, so legacy DNS deletion is refused.
                successor = @{ workers = @("ozari-staging-api-proxy"); pages = @("ozari-staging"); buckets = @("ozari-staging-assets") }
            }
        }
    }
}

function Read-OzHidden {
    # A hidden prompt: nothing is echoed, so the value never reaches the screen or the scrollback.
    param([Parameter(Mandatory = $true)][string]$Prompt)
    $secure = Read-Host -AsSecureString $Prompt
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim()
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

# Pinned, so a CLI release cannot change a script's behaviour underneath it.
$script:NeonCtl = "neonctl@8.3.5"

function Invoke-OzNeonCtl {
    # Runs the Neon CLI through `pnpm dlx`, from an empty scratch directory so pnpm never touches a
    # workspace in this repo. The API key travels as NEON_API_KEY in the environment, never as an
    # argument. stdout is returned (JSON or a connection string); it is NOT echoed.
    param([string[]]$Arguments, [switch]$AllowFailure)
    $scratch = Join-Path ([IO.Path]::GetTempPath()) "ozari-neonctl"
    if (-not (Test-Path $scratch)) { New-Item -ItemType Directory -Path $scratch | Out-Null }
    Push-Location $scratch
    $previous = $ErrorActionPreference
    try {
        # Continue, not Stop: under Stop, Windows PowerShell turns a native tool's redirected stderr
        # into a terminating error before the exit code can be looked at. A probe ($AllowFailure)
        # stays quiet; a real call lets the CLI's own error message reach the console.
        $ErrorActionPreference = "Continue"
        if ($AllowFailure) {
            $out = & pnpm --silent dlx $script:NeonCtl @Arguments --no-analytics 2>$null
        } else {
            $out = & pnpm --silent dlx $script:NeonCtl @Arguments --no-analytics
        }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
        Pop-Location
    }
    if ($code -ne 0) {
        if ($AllowFailure) { return $null }
        throw "neonctl $($Arguments[0]) $($Arguments[1]) failed (exit $code)."
    }
    return ($out -join "`n")
}

Export-ModuleMember -Function Get-OzInfraRoot, Get-OzRepoRoot, Get-OzEnvironment, Get-OzSecretsPath, Read-OzSecrets,
    Save-OzSecrets, Get-OzSecretKeys, Get-OzValue, Set-OzValue, Get-OzMissing, Import-OzAccount, Clear-OzProcessSecrets,
    New-OzHexSecret, Get-OzTarget, Read-OzHidden, Invoke-OzNeonCtl
