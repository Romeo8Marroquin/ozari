# =============================================================================
# Ozari — put ONE value into the gitignored secrets files, through a hidden prompt.
#
#   ./infrastructure/scripts/secret.ps1 account cloudflare_api_token
#   ./infrastructure/scripts/secret.ps1 staging email_key
#   ./infrastructure/scripts/secret.ps1 staging            # status: which keys are set (never values)
#
# Why a prompt and not "open the JSON and paste": the value never lands in an editor's undo buffer,
# a recent-files list, a terminal's scrollback or a shell history file. Paste at the prompt; nothing
# is echoed.
#
# Replacing an existing ENVIRONMENT value bumps its rotation counter automatically, so the next
# `tf.ps1 <env> gcp apply` pushes the new Secret Manager version (and destroys the old one).
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("account", "staging", "prod")]
    [string]$Scope,

    [Parameter(Position = 1)]
    [string]$Key = "",

    # Required to replace an existing encryption_key — see the warning below.
    [switch]$IUnderstandEncryptionKeyLoss
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

$data = Read-OzSecrets $Scope
$path = Get-OzSecretsPath $Scope

# --- Status mode ---------------------------------------------------------------
if ($Key -eq "") {
    Write-Host ""
    Write-Host "$path" -ForegroundColor Cyan
    foreach ($k in (Get-OzSecretKeys $Scope)) {
        $v = Get-OzValue $data $Scope $k
        $state = if ($v -eq "") { "EMPTY" } else { "set ($($v.Length) chars)" }
        $color = if ($v -eq "") { "Yellow" } else { "Green" }
        $rotation = ""
        if ($Scope -ne "account" -and $data.rotation.PSObject.Properties[$k]) { $rotation = "  rotation=$($data.rotation.$k)" }
        Write-Host ("  {0,-28} {1}{2}" -f $k, $state, $rotation) -ForegroundColor $color
    }
    Write-Host ""
    return
}

if ((Get-OzSecretKeys $Scope) -notcontains $Key) {
    throw "'$Key' is not a $Scope key. Valid keys: $((Get-OzSecretKeys $Scope) -join ', ')"
}

$existing = Get-OzValue $data $Scope $Key

if ($Key -eq "encryption_key" -and $existing -ne "" -and -not $IUnderstandEncryptionKeyLoss) {
    throw @"
encryption_key is already set for '$Scope', and replacing it makes every *_kms column in that
environment's database PERMANENTLY unreadable. Only do this together with discarding the database.
If that is really the intent, re-run with -IUnderstandEncryptionKeyLoss.
"@
}

# --- Format checks: catch the paste of the wrong thing before it reaches a deploy -----------------
$rules = @{
    "billing_account"            = @('^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$', 'XXXXXX-XXXXXX-XXXXXX')
    "github_app_installation_id" = @('^[0-9]+$', 'digits only')
    "cloudflare_account_id"      = @('^[0-9a-f]{32}$', '32 hex characters')
    "cloudflare_zone_id"         = @('^[0-9a-f]{32}$', '32 hex characters')
    "neon_org_id"                = @('^org-[a-z0-9-]+$', 'org-... (Organization settings -> General)')
    "database_url"               = @('^postgres(ql)?://', 'a postgresql:// URL')
    "direct_database_url"        = @('^postgres(ql)?://', 'a postgresql:// URL')
    "encryption_key"             = @('^[0-9a-fA-F]{64}$', '64 hex characters (32 bytes)')
    "email_key"                  = @('^re_', 'a Resend key, starting with re_')
    "github_oauth_token"         = @('^ghp_', 'a CLASSIC token, starting with ghp_ (Cloud Build rejects fine-grained github_pat_ tokens)')
    "google_client_id"           = @('\.apps\.googleusercontent\.com$', 'ending in .apps.googleusercontent.com')
    "google_client_secret"       = @('^GOCSPX-', 'starting with GOCSPX-')
}

Write-Host ""
if ($existing -ne "") {
    Write-Host "$Scope/$Key is already set. Entering a value REPLACES it." -ForegroundColor Yellow
}
$secure = Read-Host -AsSecureString "Paste $Scope/$Key (hidden; empty input cancels)"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
$value = $value.Trim()

if ($value -eq "") {
    Write-Host "Nothing entered; $path is unchanged."
    return
}

if ($rules.ContainsKey($Key) -and $value -notmatch $rules[$Key][0]) {
    throw "That does not look like $Key (expected $($rules[$Key][1])). Nothing was saved."
}

$bumped = Set-OzValue -Data $data -Scope $Scope -Key $Key -Value $value
Save-OzSecrets -Scope $Scope -Data $data

Write-Host "Saved $Scope/$Key ($($value.Length) chars) to $path" -ForegroundColor Green
if ($bumped) {
    Write-Host "Rotation counter bumped to $($data.rotation.$Key): the next 'tf.ps1 $Scope gcp apply' pushes it." -ForegroundColor Green
}
Write-Host ""
