# ---------------------------------------------------------------------------
# PRODUCTION — Cloudflare (DNS, the edge Worker, Pages, R2, zone-wide settings).
#
# Same zone as staging (one domain, two environments), so the two roots share a blast radius at the
# DNS level even though their states are separate. Two rules keep that safe:
#   · each root owns only the hostnames it names, and
#   · exactly ONE root owns the zone-wide settings — this one.
#
# ORDER: runs BEFORE the gcp root (see the staging root for why).
# Run through `infrastructure/scripts/tf.ps1 prod cloudflare plan|apply`.
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

# Token from CLOUDFLARE_API_TOKEN (set by tf.ps1). Never a provider argument, never a tfvars value.
provider "cloudflare" {}

data "terraform_remote_state" "bootstrap" {
  backend = "gcs"
  config = {
    bucket = var.state_bucket
    prefix = "ozari/bootstrap"
  }
}

locals {
  bootstrap          = data.terraform_remote_state.bootstrap.outputs
  cloud_run_hostname = "${var.cloud_run_service_name}-${local.bootstrap.project_number}.${local.bootstrap.region}.run.app"
}

module "cloudflare" {
  source = "../../../modules/cloudflare-env"

  account_id  = var.cloudflare_account_id
  zone_id     = var.cloudflare_zone_id
  environment = "production"

  api_hostname = "api.partyrentalsgt.com"
  # The apex. Cloudflare's CNAME flattening is what allows a CNAME here at all.
  app_hostname       = "partyrentalsgt.com"
  cloud_run_hostname = local.cloud_run_hostname

  worker_name = "ozari-prod-api-proxy"

  pages_project_name      = "ozari-prod"
  pages_production_branch = "main"
  pages_github_owner      = var.github_owner
  pages_github_repo       = var.github_repo_name
  pages_build_env         = var.pages_build_env
  vite_api_url            = "https://api.partyrentalsgt.com"

  r2_bucket_name   = "ozari-prod-assets"
  r2_custom_domain = "assets.partyrentalsgt.com"
  # ⚠️ NO localhost, ever. A development machine has no business preflighting against production
  # assets; the apex is the only origin that legitimately uploads here.
  r2_cors_allowed_origins = ["https://partyrentalsgt.com"]

  manage_zone_settings = true

  # Production is meant to be indexed.
  noindex_hostname = ""

  extra_dns_records = var.extra_dns_records
}
