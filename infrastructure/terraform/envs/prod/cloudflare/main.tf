# ---------------------------------------------------------------------------
# PRODUCTION — Cloudflare.
#
# Same zone as staging (one domain, two environments), so the two roots share a blast radius at the
# DNS level even though they have separate states. Two rules keep that safe:
#
#   · each root owns only the hostnames it names, and
#   · exactly ONE root owns the zone-wide settings — this one, once it exists.
#     Set `manage_zone_settings = false` in the staging root in the same change.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0"

  backend "gcs" {
    bucket = "ozari-prod-tfstate"
    prefix = "ozari/prod-cloudflare"
  }

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 5.20.0, < 6.0.0"
    }
  }
}

# Token from CLOUDFLARE_API_TOKEN. Never a provider argument, never a tfvars value.
provider "cloudflare" {}

data "terraform_remote_state" "gcp" {
  backend = "gcs"
  config = {
    bucket = "ozari-prod-tfstate"
    prefix = "ozari/prod"
  }
}

module "cloudflare" {
  source = "../../../modules/cloudflare-env"

  account_id  = var.cloudflare_account_id
  zone_id     = var.cloudflare_zone_id
  environment = "production"

  api_hostname       = "api.partyrentalsgt.com"
  app_hostname       = var.app_hostname
  cloud_run_hostname = data.terraform_remote_state.gcp.outputs.cloud_run_hostname

  worker_name = "api-proxy"

  pages_project_name      = var.pages_project_name
  pages_production_branch = "main"
  vite_api_url            = "https://api.partyrentalsgt.com"

  r2_bucket_name = var.r2_bucket_name
  # ⚠️ NO localhost, ever. A development machine has no business preflighting against production
  # assets, and the apex is the only origin that legitimately uploads here.
  r2_cors_allowed_origins = ["https://${var.app_hostname}"]
  r2_custom_domain        = var.r2_custom_domain

  manage_zone_settings = true

  # Production is meant to be indexed.
  noindex_hostname = ""

  extra_dns_records = var.extra_dns_records
}
