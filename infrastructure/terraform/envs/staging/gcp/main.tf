# ---------------------------------------------------------------------------
# STAGING — Google Cloud.
#
# Same module as production, different inputs. Everything that differs between the two is in this
# file, in variables.tf defaults, or in ../environment.json — never in a resource that exists only
# here, because a file that exists only in one environment is a file nobody tests.
#
# Run it through `infrastructure/scripts/tf.ps1 staging gcp plan|apply`, which supplies:
#   · the backend bucket and project_id / region          ← ../environment.json (committed)
#   · github_app_installation_id, cloudflare_account_id   ← secrets/account.json (gitignored)
#   · secret_values, secret_version_triggers              ← secrets/staging.json (gitignored)
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0"

  backend "gcs" {
    prefix = "ozari/gcp"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.6"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 8.6"
    }
  }
}

# `user_project_override` + `billing_project` charge API quota to THIS project instead of whatever
# quota project your gcloud Application Default Credentials happen to carry — which, after an old
# project is deleted, is a project that no longer exists, and every call fails naming it.
provider "google" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}

module "gcp" {
  source = "../../../modules/gcp-env"

  project_id  = var.project_id
  region      = var.region
  environment = "staging"

  service_name           = var.service_name
  artifact_repository_id = var.artifact_repository_id
  image_name             = var.image_name
  app_host               = var.app_host
  api_public_url         = var.api_public_url
  node_env               = var.node_env
  log_level              = var.log_level

  # The R2 endpoint is account-scoped, so it is derived from the account id rather than typed.
  r2_endpoint    = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
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

  github_owner               = var.github_owner
  github_repo_name           = var.github_repo_name
  github_app_installation_id = var.github_app_installation_id

  build_trigger_name         = var.build_trigger_name
  build_trigger_branch_regex = var.build_trigger_branch_regex

  artifact_keep_count           = var.artifact_keep_count
  artifact_stale_tagged_seconds = var.artifact_stale_tagged_seconds

  enable_cleanup_job = var.enable_cleanup_job
}
