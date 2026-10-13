# The project number is derived, not typed. It names Google-managed identities (the Cloud Build
# service agent, the default compute SA) and used to be a hand-copied input that could disagree with
# the project id beside it.
data "google_project" "this" {
  project_id = var.project_id
}

locals {
  project_number = data.google_project.this.number
}
