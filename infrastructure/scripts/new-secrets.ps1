# =============================================================================
# Ozari — generate the secret material an environment needs.
#
#   ./new-secrets.ps1
#
# Prints values to paste into an environment's `secrets.auto.tfvars` (gitignored). Nothing is
# written to disk and nothing leaves this machine: these are locally-generated random bytes.
#
# It deliberately does NOT generate:
#   · database URLs   → scripts/db-bootstrap.* (they carry a role and a host, not just entropy)
#   · email_key       → Resend dashboard
#   · r2_*            → Cloudflare dashboard (a Terraform-created R2 token would land in state)
#   · google_client_* → Google Auth Platform (no API can create an OAuth client)
# =============================================================================
$ErrorActionPreference = "Stop"

function New-HexSecret {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
    return (-join ($buffer | ForEach-Object { $_.ToString("x2") }))
}

$jwt        = New-HexSecret 48
$jwtRefresh = New-HexSecret 48
$encryption = New-HexSecret 32   # MUST be exactly 32 bytes → 64 hex characters. AES-256-GCM.
$apiKey     = New-HexSecret 32

Write-Host ""
Write-Host "Paste into secrets.auto.tfvars (GITIGNORED):"
Write-Host ""
Write-Host "  jwt_secret         = `"$jwt`""
Write-Host "  jwt_refresh_secret = `"$jwtRefresh`""
Write-Host "  encryption_key     = `"$encryption`""
Write-Host "  api_key            = `"$apiKey`""
Write-Host ""
Write-Host "⚠️  encryption_key is $($encryption.Length) hex characters = 32 bytes, which is what AES-256-GCM"
Write-Host "    requires. NEVER rotate it once an environment holds data: every *_kms column becomes"
Write-Host "    permanently unreadable, and there is no recovery path. Regenerating it is the same"
Write-Host "    decision as throwing the database away."
Write-Host ""
Write-Host "⚠️  These are the only copies. Paste them, then clear this terminal's scrollback."
Write-Host ""
