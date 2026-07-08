# Existing Cloud Run service adopted via import (see imports.tf).
#
# IMPORTANT: the container image tag is owned by Cloud Build (it deploys
# ${_IMAGE_URL}:$COMMIT_SHA on every push). Terraform therefore ignores changes to the
# image so the two systems don't fight. Terraform owns the STRUCTURAL config (scaling,
# concurrency, timeout, env vars, secret bindings, service account, ingress).
#
# After import, review `terraform plan` closely for:
#   - secret references rendered as short id vs. projects/<number>/secrets/<name>
#     (provider normalization). Reconcile before apply if a diff appears.
#   - any annotations/labels the live service carries that aren't represented here.

resource "google_cloud_run_v2_service" "ozari_api" {
  project  = var.project_id
  name     = var.service_name
  location = var.region

  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.run.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    max_instance_request_concurrency = var.concurrency
    timeout                          = "${var.timeout_seconds}s"

    containers {
      # Placeholder tag only; real tag is managed by Cloud Build (see lifecycle below).
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_repository_id}/${var.image_name}:latest"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # Match the live service to avoid drift. With min_instances = 0, Cloud Run only
        # bills CPU during request processing (cpu_idle) and boosts CPU at cold start.
        cpu_idle          = true
        startup_cpu_boost = true
      }

      # --- Plain env vars ---
      # NODE_ENV is the single environment switch. APP_ENV and API_BASE_PATH were
      # removed (June 2026 cleanup): APP_ENV was redundant with NODE_ENV and
      # API_BASE_PATH was never read by the app (base path is appConfig.basePath).
      # If you add a new runtime env var, add it here AND to cloudbuild.yaml's
      # `gcloud run deploy --set-env-vars` so Terraform and Cloud Build stay in sync.
      env {
        name  = "NODE_ENV"
        value = var.node_env
      }
      env {
        name  = "LOG_LEVEL"
        value = var.log_level
      }
      env {
        name  = "APP_HOST"
        value = var.app_host
      }

      # --- Secret env vars (DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET,
      #     ENCRYPTION_KEY, API_KEY) -> Secret Manager :latest ---
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ozari_database_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ozari_jwt_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "JWT_REFRESH_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ozari_jwt_refresh_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ozari_encryption_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ozari_api_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "EMAIL_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.ozari_email_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [
      # Cloud Build owns the deployed image tag.
      template[0].containers[0].image,
      # Cloud Run/console set client metadata that we don't want to thrash on.
      client,
      client_version,
      # Top-level (service) scaling is a computed default on the live service
      # (manual_instance_count = 0). We manage instance counts via template.scaling
      # (min/max) instead, so leave the service-level block untouched to avoid drift.
      scaling,
    ]
  }

  depends_on = [
    google_secret_manager_secret_iam_member.run_sa_secret_access,
  ]
}

# Public, unauthenticated invoker (allUsers -> roles/run.invoker). Additive member.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.ozari_api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
