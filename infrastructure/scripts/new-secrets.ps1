# =============================================================================
# Ozari — generate an environment's random secret material, straight into its secrets file.
#
#   ./infrastructure/scripts/new-secrets.ps1 staging                         # fill whatever is empty
#   ./infrastructure/scripts/new-secrets.ps1 staging -Rotate jwt_secret,api_key
#
# Generates jwt_secret, jwt_refresh_secret, encryption_key and api_key — locally-generated random
# bytes, nothing fetched, nothing uploaded, NOTHING PRINTED. Only key names are shown.
#
# It never overwrites a value unless told to with -Rotate, and a rotation bumps the counter so the
# next gcp apply pushes it. encryption_key additionally needs -IUnderstandEncryptionKeyLoss.
#
# Not generated here, because they are not just entropy:
#   database URLs   → neon.ps1           (they carry a role and a host)
#   email_key, r2_*, google_client_*, github_oauth_token → secret.ps1 (minted in a dashboard)
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("staging", "prod")]
    [string]$Environment,

    [ValidateSet("jwt_secret", "jwt_refresh_secret", "api_key", "encryption_key")]
    [string[]]$Rotate = @(),

    [switch]$IUnderstandEncryptionKeyLoss
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

if ($Rotate -contains "encryption_key" -and -not $IUnderstandEncryptionKeyLoss) {
    throw "Rotating encryption_key makes every *_kms column in the '$Environment' database permanently unreadable. Re-run with -IUnderstandEncryptionKeyLoss only if the database is being discarded too."
}

# Sizes: JWT HMAC keys get 48 bytes (above SHA-256's block-size guidance for HS256); the encryption
# key is EXACTLY 32 bytes because AES-256-GCM requires it (64 hex characters); the API key, 32.
$sizes = [ordered]@{
    jwt_secret         = 48
    jwt_refresh_secret = 48
    encryption_key     = 32
    api_key            = 32
}

$data = Read-OzSecrets $Environment
$generated = @()
$rotated = @()

foreach ($key in $sizes.Keys) {
    $current = Get-OzValue $data $Environment $key
    if ($current -eq "" -or $Rotate -contains $key) {
        $bumped = Set-OzValue -Data $data -Scope $Environment -Key $key -Value (New-OzHexSecret $sizes[$key])
        if ($bumped) { $rotated += $key } else { $generated += $key }
    }
}

Save-OzSecrets -Scope $Environment -Data $data

Write-Host ""
if ($generated.Count -gt 0) { Write-Host "Generated: $($generated -join ', ')" -ForegroundColor Green }
if ($rotated.Count -gt 0) { Write-Host "Rotated (counter bumped): $($rotated -join ', ')" -ForegroundColor Green }
if ($generated.Count -eq 0 -and $rotated.Count -eq 0) { Write-Host "Nothing to do: every generated secret for '$Environment' is already set." }
Write-Host "File: $(Get-OzSecretsPath $Environment)"
if ($generated -contains "encryption_key") {
    Write-Host ""
    Write-Host "encryption_key is new. Back this file up OFF this machine now: if it is lost while the" -ForegroundColor Yellow
    Write-Host "database holds data, every encrypted column is unrecoverable." -ForegroundColor Yellow
}
Write-Host ""
