# ---------------------------------------------------------------------------
# STAGING — Cloudflare (DNS, the edge Worker, Pages, R2).
#
# A SEPARATE root with its own state, deliberately:
#  1. Different credentials. This root needs a Cloudflare API token; the GCP root needs Google ADC.
#     A routine Cloud Run change never asks for a token that can rewrite DNS.
#  2. Different blast radius. The zone is LIVE and SHARED (the unrelated `qa-ulew` landing page lives
#     on it). An apply here can take a hostname offline; an apply next door cannot reach the zone.
#
# ORDER: this root runs BEFORE the gcp root. It needs only the project number (from the bootstrap
# state) to compute Cloud Run's deterministic hostname — and the gcp root needs the R2 credentials,
# which can only be minted once the bucket created here exists.
#
# Run through `infrastructure/scripts/tf.ps1 staging cloudflare plan|apply`, which supplies the
# state bucket (environment.json) and the account/zone ids + API token (secrets/account.json).
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0"

  backend "gcs" {
    prefix = "ozari/cloudflare"
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.27"
    }
  }
}

# ⚠️ The token comes from the CLOUDFLARE_API_TOKEN environment variable (tf.ps1 sets it from
# secrets/account.json for this process only) and must NEVER be a provider argument — that would
# record it in state. Required scopes are listed in infrastructure/templates/account.example.json.
provider "cloudflare" {}

data "terraform_remote_state" "bootstrap" {
  backend = "gcs"
  config = {
    bucket = var.state_bucket
    prefix = "ozari/bootstrap"
  }
}

locals {
  bootstrap = data.terraform_remote_state.bootstrap.outputs

  # Cloud Run's deterministic URL. Must use the SAME service name as the gcp root (`ozari-api`).
  cloud_run_hostname = "${var.cloud_run_service_name}-${local.bootstrap.project_number}.${local.bootstrap.region}.run.app"
}

module "cloudflare" {
  source = "../../../modules/cloudflare-env"

  account_id  = var.cloudflare_account_id
  zone_id     = var.cloudflare_zone_id
  environment = "staging"

  api_hostname       = "api-staging.partyrentalsgt.com"
  app_hostname       = "staging.partyrentalsgt.com"
  cloud_run_hostname = local.cloud_run_hostname

  worker_name = "ozari-staging-api-proxy"

  pages_project_name      = "ozari-staging"
  pages_production_branch = "dev"
  pages_github_owner      = var.github_owner
  pages_github_repo       = var.github_repo_name
  pages_build_env         = var.pages_build_env
  vite_api_url            = "https://api-staging.partyrentalsgt.com"

  r2_bucket_name   = "ozari-staging-assets"
  r2_custom_domain = "assets-stg.partyrentalsgt.com"
  # localhost is listed HERE and must never be listed in production: local development uploads to
  # the staging bucket. CORS is only a browser gate (the presigned signature is the real
  # authorization), but a compromised dev machine should not be able to preflight against prod.
  r2_cors_allowed_origins = [
    "http://localhost:5173",
    "https://staging.partyrentalsgt.com",
  ]

  # Zone-wide settings belong to production alone.
  manage_zone_settings = false

  # `public/robots.txt` ships Allow: / for the marketing pages, so without this a crawler can index
  # the staging app under the brand domain.
  noindex_hostname = "staging.partyrentalsgt.com"

  extra_dns_records = {}
}
