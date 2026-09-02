# ---------------------------------------------------------------------------
# STAGING — Cloudflare (DNS, the edge Worker, Pages, R2).
#
# A SEPARATE root with its own state, deliberately. Two reasons:
#
#  1. Different credentials. This root needs a Cloudflare API token; the GCP root needs Google ADC.
#     Keeping them apart means a routine Cloud Run change never asks for a token that can rewrite
#     your DNS.
#  2. Different blast radius. The zone is LIVE and SHARED with other things on this account. An
#     apply here can take a site offline; an apply next door cannot reach the zone at all.
#
# The one value that crosses the boundary — the run.app hostname the Worker proxies to — is read
# from the GCP root's state rather than typed. That is what dissolves the old runbook step "deploy
# first, then copy the generated URL into the Worker by hand".
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0"

  backend "gcs" {
    bucket = "ozari-500103-tfstate"
    prefix = "ozari/staging-cloudflare"
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 5.20.0, < 6.0.0"
    }
  }
}

# ⚠️ The API token is read from the CLOUDFLARE_API_TOKEN environment variable and must NEVER be put
# in a tfvars file — a provider argument would be recorded in state. Required scopes:
#   Zone:DNS:Edit · Zone:Zone Settings:Edit · Zone:Workers Routes:Edit
#   Account:Workers Scripts:Edit · Account:Cloudflare Pages:Edit · Account:Workers R2 Storage:Edit
provider "cloudflare" {}

data "terraform_remote_state" "gcp" {
  backend = "gcs"
  config = {
    bucket = "ozari-500103-tfstate"
    prefix = "ozari/staging"
  }
}

module "cloudflare" {
  source = "../../../modules/cloudflare-env"

  account_id  = var.cloudflare_account_id
  zone_id     = var.cloudflare_zone_id
  environment = "staging"

  api_hostname       = "api-staging.partyrentalsgt.com"
  app_hostname       = "staging.partyrentalsgt.com"
  cloud_run_hostname = data.terraform_remote_state.gcp.outputs.cloud_run_hostname

  worker_name = "api-staging-proxy"

  pages_project_name      = var.pages_project_name
  pages_production_branch = "dev"
  vite_api_url            = "https://api-staging.partyrentalsgt.com"

  r2_bucket_name = var.r2_bucket_name
  # localhost is listed HERE and must never be listed in production: local development uploads to
  # the staging bucket, and CORS is only a browser gate (the presigned signature is the real
  # authorization), but a compromised dev machine should not be able to preflight against prod.
  r2_cors_allowed_origins = [
    "http://localhost:5173",
    "https://staging.partyrentalsgt.com",
  ]

  # Zone settings are shared by every hostname on partyrentalsgt.com, so exactly one environment
  # owns them. Production takes ownership when it exists; until then, staging does.
  manage_zone_settings = var.manage_zone_settings

  # `public/robots.txt` ships Allow: / for the future marketing site, so without this a crawler can
  # index the staging app under the brand domain.
  noindex_hostname = "staging.partyrentalsgt.com"

  extra_dns_records = var.extra_dns_records
}
