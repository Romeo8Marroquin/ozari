# Existing Docker repository adopted via import (see imports.tf).
# TODO(hardening): vulnerability scanning is currently disabled on this repo. Consider
# enabling Container Analysis / on-push scanning in a later pass.
resource "google_artifact_registry_repository" "ozari_images" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repository_id
  format        = "DOCKER"
  # Preserve the live description as-is for a no-op adoption.
  description = "Docker images for OZARI API"
}
