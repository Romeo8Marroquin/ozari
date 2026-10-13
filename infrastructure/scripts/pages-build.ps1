# =============================================================================
# Ozari — start a production build of an environment's Cloudflare Pages project, now.
#
#   ./infrastructure/scripts/pages-build.ps1 staging
#
# When you need it: right after the first `tf.ps1 <env> cloudflare apply` (a brand-new project has
# never built), and after any change to VITE_API_URL or other build variables — Vite INLINES them at
# build time, so Terraform changing the value does nothing until the next build. A normal push to the
# branch also builds, but only when it touches ozari-app/ (the project's watch path).
#
# Uses the Cloudflare API with the token in secrets/account.json (Cloudflare Pages:Edit).
# =============================================================================
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("staging", "prod")]
    [string]$Environment
)

$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\Ozari.Infra.psm1") -Force

# Must match envs/<env>/cloudflare/main.tf.
$projects = @{ staging = @{ name = "ozari-staging"; branch = "dev" }; prod = @{ name = "ozari-prod"; branch = "main" } }
$p = $projects[$Environment]

try {
    $acct = Import-OzAccount -Require @("cloudflare_account_id", "cloudflare_api_token")
    $headers = @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" }
    $uri = "https://api.cloudflare.com/client/v4/accounts/$($acct.cloudflare_account_id)/pages/projects/$($p.name)/deployments"

    # For a Git-connected project, POSTing a branch builds that branch's latest commit. The endpoint
    # takes multipart/form-data, built by hand because Windows PowerShell 5.1 has no -Form.
    $boundary = [guid]::NewGuid().ToString("N")
    $body = "--$boundary`r`nContent-Disposition: form-data; name=`"branch`"`r`n`r`n$($p.branch)`r`n--$boundary--`r`n"
    $r = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -ContentType "multipart/form-data; boundary=$boundary"
    if (-not $r.success) { throw "Cloudflare refused the build: $($r.errors | ConvertTo-Json -Compress)" }

    Write-Host "Build started for $($p.name) from '$($p.branch)'." -ForegroundColor Green
    Write-Host "  deployment: $($r.result.id)"
    Write-Host "  preview URL (live when the build finishes): $($r.result.url)"
    Write-Host "Follow it in Cloudflare → Workers & Pages → $($p.name) → Deployments."
} finally {
    Clear-OzProcessSecrets
}
