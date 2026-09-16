# ---------------------------------------------------------------------------
# Scheduled maintenance (opt-in: var.enable_cleanup_job).
#
# `pnpm cleanup:sessions` removes expired jwt_sessions, spent password_reset_tokens and lapsed
# auth_attempts rows. It is DML only, so it runs as the app's least-privileged role like every other
# runtime query — a maintenance job is not a reason to hand something DDL rights.
#
# Deliberately NOT scheduled: `purge:evidence`. It deletes photographs of completed work, and a
# retention purge is a decision somebody makes, not a thing that happens at 4am.
# ---------------------------------------------------------------------------

resource "google_service_account" "scheduler" {
  count = var.enable_cleanup_job ? 1 : 0

  project      = var.project_id
  account_id   = "ozari-scheduler-sa"
  display_name = "Ozari Cloud Scheduler"
  description  = "Invokes scheduled maintenance jobs for ${var.environment}. Invokes only; reads nothing."

  depends_on = [google_project_service.required]
}

resource "google_cloud_run_v2_job" "cleanup_sessions" {
  count = var.enable_cleanup_job ? 1 : 0

  project  = var.project_id
  name     = "${var.service_name}-cleanup-sessions"
  location = var.region

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }

  template {
    task_count = 1

    template {
      service_account = google_service_account.run.email
      max_retries     = 1
      timeout         = "600s"

      containers {
        image   = "${local.image_url}:latest"
        command = ["pnpm"]
        args    = ["cleanup:sessions"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        env {
          name  = "NODE_ENV"
          value = var.node_env
        }
        env {
          name  = "LOG_LEVEL"
          value = var.log_level
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.this["database_url"].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    # Same division as the service: the job runs whatever image the last deploy published.
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }

  depends_on = [
    google_secret_manager_secret_version.this,
    google_secret_manager_secret_iam_member.run_sa,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_invokes_cleanup" {
  count = var.enable_cleanup_job ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.cleanup_sessions[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler[0].email}"
}

resource "google_cloud_scheduler_job" "cleanup_sessions" {
  count = var.enable_cleanup_job ? 1 : 0

  project   = var.project_id
  region    = var.region
  name      = "${var.service_name}-cleanup-sessions"
  schedule  = var.cleanup_job_schedule
  time_zone = var.cleanup_job_timezone

  attempt_deadline = "600s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.cleanup_sessions[0].name}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler[0].email
    }
  }

  depends_on = [google_cloud_run_v2_job_iam_member.scheduler_invokes_cleanup]
}
