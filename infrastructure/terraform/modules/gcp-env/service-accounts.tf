# Two service accounts, and the split matters: the runtime never gets deploy rights, and the
# deployer never gets to read the app's secrets (beyond the database URLs it needs for migrations).

resource "google_service_account" "run" {
  project      = var.project_id
  account_id   = "ozari-run-sa"
  display_name = "Ozari Cloud Run runtime"
  description  = "Runtime identity for the ${var.environment} API. Reads secrets; deploys nothing."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "build" {
  project      = var.project_id
  account_id   = "ozari-build-sa"
  display_name = "Ozari Cloud Build deployer"
  description  = "Build/deploy identity for ${var.environment}. Pushes images, runs migrations, deploys Cloud Run."

  depends_on = [google_project_service.required]
}
