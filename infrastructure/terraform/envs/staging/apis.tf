# Required service APIs. Enabling an already-enabled API is a no-op (idempotent).
# disable_on_destroy = false so `terraform destroy` never turns these off project-wide.
# Not imported: these are project-config toggles, not resources we adopt.

locals {
  required_apis = [
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  for_each = toset(local.required_apis)

  project = var.project_id
  service = each.value

  disable_on_destroy         = false
  disable_dependent_services = false
}
