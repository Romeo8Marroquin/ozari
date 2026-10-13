# ---------------------------------------------------------------------------
# PRODUCTION — bootstrap (project + billing link + state bucket).
#
# Run through `infrastructure/scripts/tf.ps1 prod bootstrap plan|apply`. The FIRST run has no
# bucket to keep state in yet, so tf.ps1 applies with a temporary local backend and then migrates
# the state into the bucket this root just created. Every later run uses the bucket directly.
#
# Identity (project id, region, bucket) comes from ../environment.json via TF_VAR_*; the billing
# account comes from the gitignored infrastructure/secrets/account.json. Nothing to edit here.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.11.0"

  # Partial configuration: tf.ps1 supplies `bucket` from environment.json. A backend block cannot
  # read a variable, and this keeps the bucket name in exactly one file instead of three.
  backend "gcs" {
    prefix = "ozari/bootstrap"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.6"
    }
  }
}

provider "google" {
  region = var.region
}

module "bootstrap" {
  source = "../../../modules/bootstrap"

  environment       = "production"
  project_id        = var.project_id
  project_name      = var.project_name
  billing_account   = var.billing_account
  region            = var.region
  state_bucket_name = var.state_bucket
}

variable "project_id" {
  type = string
}

variable "project_name" {
  type = string
}

variable "region" {
  type = string
}

variable "state_bucket" {
  type = string
}

variable "billing_account" {
  type = string
}

output "project_id" {
  value = module.bootstrap.project_id
}

output "project_number" {
  value = module.bootstrap.project_number
}

output "region" {
  value = module.bootstrap.region
}

output "state_bucket" {
  value = module.bootstrap.state_bucket
}
