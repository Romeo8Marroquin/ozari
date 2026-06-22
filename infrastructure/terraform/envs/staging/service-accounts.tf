# Existing service accounts adopted via import (see imports.tf).
# display_name is best-effort; if the live values differ, `terraform plan` will show
# an in-place update — review before apply.

resource "google_service_account" "run" {
  project    = var.project_id
  account_id = "ozari-run-sa"
  # Preserve the live display name as-is for a no-op adoption.
  display_name = "Ozari Cloud Run runtime"
}

resource "google_service_account" "build" {
  project    = var.project_id
  account_id = "ozari-build-sa"
  # Preserve the live display name as-is for a no-op adoption.
  display_name = "Ozari Cloud Build deployer"
}
