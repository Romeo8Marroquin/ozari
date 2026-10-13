# ---------------------------------------------------------------------------
# Cloud Run — the service shell.
#
# Terraform owns the STRUCTURE (identity, scaling, concurrency, timeout, env, secret bindings,
# ingress). Cloud Build owns the deployed IMAGE TAG, which is why the image is in `ignore_changes`:
# the two systems write to the same resource on different cadences and must not fight.
#
# The service depends_on the secret VERSIONS, not just the containers. A binding to `:latest` on a
# secret with no version fails the deploy, and that ordering used to be a documented two-phase
# apply the operator had to remember. It is an edge in the graph now.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  name     = var.service_name
  location = var.region

  ingress = "INGRESS_TRAFFIC_ALL"

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }

  template {
    service_account = google_service_account.run.email

    # Rolls a new revision whenever a runtime secret is rotated (secrets.tf explains why). Cloud
    # Build's `gcloud run deploy` passes no label flags, so it keeps this one.
    labels = {
      secrets-generation = local.runtime_secrets_generation
    }

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    max_instance_request_concurrency = var.concurrency
    timeout                          = "${var.timeout_seconds}s"

    containers {
      # Placeholder only — the live tag belongs to Cloud Build (see lifecycle below). It is Google's
      # public sample, NOT our `:latest`: on a fresh environment the registry is still empty, and
      # Cloud Run refuses to create a service whose image does not exist (the apply fails and leaves
      # a tainted service behind deletion protection). The first deploy replaces it.
      image = local.bootstrap_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # With min_instances = 0, CPU is billed only while a request is in flight, and boosted at
        # cold start so the first request after scale-to-zero is not punished.
        cpu_idle          = true
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.runtime_env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.runtime_secret_bindings
        content {
          name = env.value.env_var
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.this[env.key].secret_id
              version = "latest"
            }
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
      template[0].containers[0].image,
      client,
      client_version,
      # Service-level scaling is a computed default; instance counts are managed on the template.
      scaling,
    ]
  }

  depends_on = [
    google_secret_manager_secret_version.this,
    google_secret_manager_secret_iam_member.run_sa,
  ]
}

# Public, unauthenticated. The app does its own authentication; Cloud Run IAM is not the gate.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
