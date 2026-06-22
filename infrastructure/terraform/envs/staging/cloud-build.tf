# Existing regional Cloud Build trigger (2nd-gen GitHub connection) adopted via import.
# The build steps themselves live in ozari-api/cloudbuild.yaml (referenced by filename).
#
# TODO(terraform-ownership): once adoption settles, the build should ideally only
# build/push the image, run Prisma migrations, and update the Cloud Run image — while
# Terraform owns the structural Cloud Run config. See the TODO in ozari-api/cloudbuild.yaml.

resource "google_cloudbuild_trigger" "ozari_api_dev" {
  project     = var.project_id
  location    = var.region
  name        = var.build_trigger_name
  description = "Ozari development deploy"

  service_account = "projects/${var.project_id}/serviceAccounts/${google_service_account.build.email}"

  repository_event_config {
    repository = var.github_repository_resource

    push {
      branch = var.build_trigger_branch_regex
    }
  }

  filename       = "ozari-api/cloudbuild.yaml"
  included_files = ["ozari-api/**"]

  # Preserve the live trigger setting (build logs streamed with status).
  include_build_logs = "INCLUDE_BUILD_LOGS_WITH_STATUS"

  substitutions = {
    _APP_HOST     = var.app_host
    _IMAGE_URL    = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_repository_id}/${var.image_name}"
    _NODE_ENV     = var.node_env
    _REGION       = var.region
    _RUN_SA       = google_service_account.run.email
    _SERVICE_NAME = var.service_name
  }
}
