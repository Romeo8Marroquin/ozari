# ---------------------------------------------------------------------------
# Cloud Build — the GitHub connection, the repository link, and the trigger.
#
# What Terraform CAN declare: the connection, the repository link, the trigger and every
# substitution. What no API can do, in any tool:
#
#   1. Install the Cloud Build GitHub App on the repository (a human clicks Install on github.com).
#   2. Mint the personal access token the connection authenticates with.
#
# Both are one-time per GitHub account. Everything downstream of them is code.
# ---------------------------------------------------------------------------

resource "google_cloudbuildv2_connection" "github" {
  count = var.manage_github_connection ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = var.github_connection_name

  github_config {
    app_installation_id = var.github_app_installation_id

    # `latest` rather than a pinned version, so rotating the PAT is the same two-step as any other
    # secret here (new value + bump its counter) and does not require editing this resource.
    authorizer_credential {
      oauth_token_secret_version = "${google_secret_manager_secret.this["github_oauth_token"].id}/versions/latest"
    }
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_version.this,
    google_secret_manager_secret_iam_member.cloudbuild_agent_reads_github_token,
  ]
}

resource "google_cloudbuildv2_repository" "app" {
  count = var.manage_github_connection ? 1 : 0

  project           = var.project_id
  location          = var.region
  name              = var.github_repo_name
  parent_connection = google_cloudbuildv2_connection.github[0].name
  remote_uri        = "https://github.com/${var.github_owner}/${var.github_repo_name}.git"
}

locals {
  # Either the repository Terraform manages, or the resource string of one created in the console.
  build_repository = var.manage_github_connection ? google_cloudbuildv2_repository.app[0].id : var.github_repository_resource
}

resource "google_cloudbuild_trigger" "deploy" {
  project     = var.project_id
  location    = var.region
  name        = var.build_trigger_name
  description = "Ozari ${var.environment} deploy"

  service_account = "projects/${var.project_id}/serviceAccounts/${google_service_account.build.email}"

  repository_event_config {
    repository = local.build_repository

    push {
      branch = var.build_trigger_branch_regex
    }
  }

  filename       = var.build_config_path
  included_files = ["ozari-api/**"]

  include_build_logs = "INCLUDE_BUILD_LOGS_WITH_STATUS"

  # The build's whole environment. `_SET_ENV_VARS` and `_SET_SECRETS` are the computed contract from
  # locals.tf — cloudbuild.yaml forwards them verbatim, so the deploy command and this Terraform can
  # no longer describe different services.
  substitutions = {
    _REGION       = var.region
    _SERVICE_NAME = var.service_name
    _IMAGE_URL    = local.image_url
    _RUN_SA       = google_service_account.run.email

    _SET_ENV_VARS = local.set_env_vars_arg
    _SET_SECRETS  = local.set_secrets_arg

    # Cloud Run shape. Kept identical to the values Terraform sets on the service itself; if they
    # ever differ, an apply and a deploy will thrash the service on alternate runs.
    _MIN_INSTANCES = tostring(var.min_instances)
    _MAX_INSTANCES = tostring(var.max_instances)
    _CONCURRENCY   = tostring(var.concurrency)
    _TIMEOUT       = tostring(var.timeout_seconds)
    _CPU           = var.cpu
    _MEMORY        = var.memory

    # The migration step reads the OWNER connection string; the app never sees it.
    _DIRECT_DATABASE_URL_SECRET = local.secrets.direct_database_url.secret_id
  }

  depends_on = [google_project_service.required]
}
