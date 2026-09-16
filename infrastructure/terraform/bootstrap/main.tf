# ---------------------------------------------------------------------------
# BOOTSTRAP — the two things that must exist before an environment root can run.
#
# This root creates the production GCP project and its Terraform state bucket. It exists because
# those were the first two entries on the "irreducible manual steps" list, and neither of them is
# actually irreducible: both have APIs. What genuinely cannot be automated is what comes BEFORE it —
# a Google account and a billing account with a payment method on file.
#
# Its own state lives in the STAGING bucket under a separate prefix, which is the honest answer to
# "where does the state of the thing that creates state buckets live?". That bucket was created by
# `infrastructure/bootstrap/create-tfstate-bucket.*`, which is a script rather than Terraform for
# exactly the same reason.
#
# Run this ONCE per new environment, then never again. It is deliberately in its own root so a
# routine `terraform apply` on an environment can never propose deleting a project.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0"

  backend "gcs" {
    bucket = "ozari-500103-tfstate"
    prefix = "ozari/bootstrap"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.20.0, < 7.0.0"
    }
  }
}

provider "google" {
  region = var.region
}

# ---------------------------------------------------------------------------
# The project.
#
# Requires the caller to hold `roles/resourcemanager.projectCreator` (a personal Google Cloud
# account has it implicitly) and `roles/billing.user` on the billing account — without the second
# one the project is created UNLINKED and every API enablement afterwards fails with a billing
# error that names neither cause.
#
# No org_id / folder_id: this account has no organisation, so the project is created standalone.
# ---------------------------------------------------------------------------

resource "google_project" "env" {
  name            = var.project_name
  project_id      = var.project_id
  billing_account = var.billing_account

  # ⚠️ PREVENT means `terraform destroy` refuses to delete the project rather than doing it. Deleting
  # a project takes its databases, buckets, secrets and audit history with it, and the 30-day
  # recovery window is not something to rely on. To really delete it, change this, apply, then
  # destroy — two deliberate steps.
  deletion_policy = "PREVENT"

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }
}

# APIs the environment root will need before it can do anything, including reading its own state.
# The environment module enables the full set; these are just enough to bootstrap.
resource "google_project_service" "bootstrap" {
  for_each = toset([
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])

  project = google_project.env.project_id
  service = each.value

  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# The state bucket for this environment.
#
# Versioning is not optional. Terraform state is the only record of what exists; a corrupted or
# truncated write with no history is a manual reconstruction of every resource id.
# ---------------------------------------------------------------------------

resource "google_storage_bucket" "tfstate" {
  project  = google_project.env.project_id
  name     = var.state_bucket_name
  location = var.state_bucket_location

  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  # State files are small; keep a bounded history rather than every version forever.
  lifecycle_rule {
    condition {
      num_newer_versions = 20
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
