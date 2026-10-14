# Service APIs. Enabling an already-enabled API is a no-op, so this is safe on an adopted project
# and is what makes a brand-new project reachable by the rest of this module.
#
# disable_on_destroy = false: a `terraform destroy` must never turn an API off project-wide — other
# things in the project (and the console itself) depend on them.

locals {
  required_apis = concat(
    [
      "cloudresourcemanager.googleapis.com",
      "serviceusage.googleapis.com",
      "run.googleapis.com",
      "cloudbuild.googleapis.com",
      "artifactregistry.googleapis.com",
      "secretmanager.googleapis.com",
      "iam.googleapis.com",
      # The Google Calendar integration calls this API with an OAuth client that lives in THIS
      # project, so it must be enabled here. The client itself stays manual (DEPLOYMENT.md §3d).
      "calendar-json.googleapis.com",
      # The spend cap (spend-cap.tf): the budget, its Pub/Sub topic, the function and the API it calls.
      "billingbudgets.googleapis.com",
      "cloudbilling.googleapis.com",
      "pubsub.googleapis.com",
      "cloudfunctions.googleapis.com",
      "eventarc.googleapis.com",
      "storage.googleapis.com",
    ],
    var.enable_cleanup_job ? ["cloudscheduler.googleapis.com"] : [],
  )
}

resource "google_project_service" "required" {
  for_each = toset(local.required_apis)

  project = var.project_id
  service = each.value

  disable_on_destroy         = false
  disable_dependent_services = false
}
