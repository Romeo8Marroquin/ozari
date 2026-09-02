# ---------------------------------------------------------------------------
# STAGING — Google Cloud.
#
# State prefix is unchanged (`ozari/staging`), so this root continues the state the first adoption
# pass created. The resources moved into a module; `moved.tf` tells Terraform that, and a plan should
# therefore show moves and in-place updates — never a destroy of the Cloud Run service, the registry,
# the service accounts or a secret container. If it does, stop and read before applying.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0"

  backend "gcs" {
    bucket = "ozari-500103-tfstate"
    prefix = "ozari/staging"
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

  # Values live in secrets.auto.tfvars (gitignored). Triggers are committed, because a rotation
  # counter is not a secret and its history is exactly what you want in git.
  secret_values           = var.secret_values
  secret_version_triggers = var.secret_version_triggers

  build_trigger_name         = var.build_trigger_name
  build_trigger_branch_regex = var.build_trigger_branch_regex

  # The staging connection was created in the console and works. Importing a live 2nd-gen connection
  # is known to perma-diff on app_installation_id, so it is referenced by resource string until the
  # rebuild, when it gets created from scratch with manage_github_connection = true.
  manage_github_connection   = var.manage_github_connection
  github_repository_resource = var.github_repository_resource
  github_owner               = var.github_owner
  github_repo_name           = var.github_repo_name
  github_app_installation_id = var.github_app_installation_id

  enable_cleanup_job               = var.enable_cleanup_job
  revoke_default_compute_sa_editor = var.revoke_default_compute_sa_editor
}
