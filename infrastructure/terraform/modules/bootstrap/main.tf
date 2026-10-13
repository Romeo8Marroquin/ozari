# ---------------------------------------------------------------------------
# bootstrap — the two things an environment needs before anything else can run: its GCP project
# (linked to billing) and the bucket that holds its Terraform state.
#
# EVERY ENVIRONMENT BOOTSTRAPS ITSELF, INTO ITSELF. This module's own state ends up inside the bucket
# it creates (`tf.ps1` runs the first apply with a local backend, then migrates the state across).
# So each project is self-contained: deleting staging's project takes staging's state with it and
# cannot touch production's. The previous design kept every environment's state in the staging
# project, which made the disposable environment the one nobody could dispose of.
#
# What genuinely cannot be automated sits BEFORE this module: a Google account and a billing account
# with a payment method on file.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.6"
    }
  }
}

# ---------------------------------------------------------------------------
# The project.
#
# Requires the caller to hold `roles/resourcemanager.projectCreator` (implicit on a personal Google
# Cloud account) and `roles/billing.user` on the billing account. Without the second one the project
# is created UNLINKED, and every API enablement afterwards fails with a billing error that names
# neither cause.
#
# No org_id / folder_id: the account has no organisation, so the project is standalone.
# ---------------------------------------------------------------------------

resource "google_project" "env" {
  name            = var.project_name
  project_id      = var.project_id
  billing_account = var.billing_account

  # ⚠️ PREVENT means `terraform destroy` refuses to delete the project. Deleting a project takes its
  # secrets, images, state and audit history with it. Retiring an environment is a documented,
  # deliberate step (`gcloud projects delete`, REBUILD.md), never a side effect of a destroy.
  deletion_policy = "PREVENT"

  # A new project would otherwise get the legacy "default" VPC network, firewall rules and all —
  # none of which Cloud Run, Cloud Build or Secret Manager need. Not creating it means there is no
  # network attack surface to forget about.
  auto_create_network = false

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }
}

# Just enough API surface to create the state bucket and let the environment root take over. The
# gcp-env module enables the full set.
resource "google_project_service" "bootstrap" {
  for_each = toset([
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
    "cloudbilling.googleapis.com",
  ])

  project = google_project.env.project_id
  service = each.value

  disable_on_destroy         = false
  disable_dependent_services = false
}

# ---------------------------------------------------------------------------
# The state bucket.
#
# Versioning is not optional: state is the only record of what exists, and a truncated write with no
# history means reconstructing every resource id by hand. State files are kilobytes, so the bucket
# costs nothing measurable even outside the free-tier regions.
# ---------------------------------------------------------------------------

resource "google_storage_bucket" "tfstate" {
  project  = google_project.env.project_id
  name     = var.state_bucket_name
  location = var.region

  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  # Keep a bounded history rather than every version forever.
  lifecycle_rule {
    condition {
      num_newer_versions = 20
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }

  depends_on = [google_project_service.bootstrap]
}
