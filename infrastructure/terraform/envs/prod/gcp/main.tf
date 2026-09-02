# ---------------------------------------------------------------------------
# PRODUCTION — Google Cloud.
#
# Same module as staging, different inputs. That is the whole design: if production ever needs a
# resource staging does not have, it goes in the module behind a variable — never as a file that
# exists only here, because a file that exists only here is a file nobody tests until the day it
# matters.
#
# Production lives in its own GCP PROJECT. Free tiers are per BILLING ACCOUNT, so the isolation is
# free: it buys a hard blast-radius boundary (a wrong `-target` in staging cannot reach prod), lets
# both environments use identical secret names, and keeps IAM separate.
#
# The project itself is created by `infrastructure/terraform/bootstrap` — run that first.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0"

  backend "gcs" {
    # The prod state bucket, created by the bootstrap root. Deliberately NOT the staging bucket:
    # state is as sensitive as the environment it describes.
    bucket = "ozari-prod-tfstate"
    prefix = "ozari/prod"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.20.0, < 7.0.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

module "gcp" {
  source = "../../../modules/gcp-env"

  project_id     = var.project_id
  project_number = var.project_number
  region         = var.region
  environment    = var.environment

  service_name           = var.service_name
  artifact_repository_id = var.artifact_repository_id
  image_name             = var.image_name
  app_host               = var.app_host
  api_public_url         = var.api_public_url
  node_env               = var.node_env
  log_level              = var.log_level

  r2_endpoint    = var.r2_endpoint
  r2_bucket_name = var.r2_bucket_name
  r2_public_url  = var.r2_public_url

  min_instances   = var.min_instances
  max_instances   = var.max_instances
  concurrency     = var.concurrency
  timeout_seconds = var.timeout_seconds
  cpu             = var.cpu
  memory          = var.memory

  secret_values           = var.secret_values
  secret_version_triggers = var.secret_version_triggers

  # A NEW project has no console-created connection to inherit, so Terraform declares it. The two
  # manual prerequisites are unavoidable and one-time: install the Cloud Build GitHub App on the
  # repository, and put a GitHub PAT (REPO_ADMIN scope) in the secret named below.
  manage_github_connection     = true
  github_connection_name       = var.github_connection_name
  github_owner                 = var.github_owner
  github_repo_name             = var.github_repo_name
  github_app_installation_id   = var.github_app_installation_id
  github_oauth_token_secret_id = var.github_oauth_token_secret_id

  build_trigger_name         = var.build_trigger_name
  build_trigger_branch_regex = var.build_trigger_branch_regex

  # Production keeps a tighter registry: two rollback targets and a two-week window for stale tags.
  artifact_keep_count           = var.artifact_keep_count
  artifact_stale_tagged_seconds = var.artifact_stale_tagged_seconds

  enable_cleanup_job = var.enable_cleanup_job

  # A brand-new project has nothing legitimate holding roles/editor, so this is safe to declare from
  # the start here — unlike on staging, where it would strip bindings that predate Terraform.
  revoke_default_compute_sa_editor = var.revoke_default_compute_sa_editor
}
