# ---------------------------------------------------------------------------
# Spend cap — a HARD monthly ceiling per environment.
#
# A Google Cloud budget on its own only emails; spending never stops. Google's documented way to
# enforce a cap (cloud.google.com/billing/docs/how-to/disable-billing-with-notifications) is wired
# here end to end:
#
#   budget (this project only, US$ var.monthly_budget_usd) ──Pub/Sub──▶ function ──▶ unlink billing
#
# The budget also emails the billing account's admins at 50 / 90 / 100 %. When the month's cost
# reaches 100 %, the function unlinks THIS project from the billing account and every paid service in
# it stops — the API goes down rather than the bill growing. Data outside Google (Neon, R2) is not
# touched. Recovery is manual by design: INCIDENTS.md S12.
#
# Not instantaneous: Google reports cost with a delay of hours, so the cap can be overshot by what
# the project spends in that window. Cloud Run's max_instances bounds that to a few dollars a day.
#
# Raise or lower the ceiling with `monthly_budget_usd` in envs/<env>/gcp/variables.tf + plan/apply.
# ---------------------------------------------------------------------------

locals {
  spend_cap_name = "ozari-spend-cap"
}

resource "google_pubsub_topic" "spend_cap" {
  project = var.project_id
  name    = local.spend_cap_name

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }

  depends_on = [google_project_service.required]
}

# Cloud Billing publishes budget notifications as this Google-managed identity.
resource "google_pubsub_topic_iam_member" "budget_publishes" {
  project = var.project_id
  topic   = google_pubsub_topic.spend_cap.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:billing-budget-alert@system.gserviceaccount.com"
}

resource "google_billing_budget" "cap" {
  billing_account = var.billing_account
  display_name    = "ozari-${var.environment}-cap"

  budget_filter {
    projects               = ["projects/${local.project_number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  all_updates_rule {
    pubsub_topic   = google_pubsub_topic.spend_cap.id
    schema_version = "1.0"
    # Keep the default emails to the billing account's admins (you) as well.
    disable_default_iam_recipients = false
  }

  depends_on = [
    google_project_service.required,
    google_pubsub_topic_iam_member.budget_publishes,
  ]
}

# --- The function's identity: one permission, on this project only -----------

resource "google_service_account" "spend_cap" {
  project      = var.project_id
  account_id   = "ozari-spend-cap-sa"
  display_name = "Ozari spend cap"
  description  = "Unlinks billing from ${var.project_id} when the monthly budget is reached. Nothing else."

  depends_on = [google_project_service.required]
}

# Project Billing Manager = link/unlink THIS project's billing. It grants nothing on the billing
# account and nothing on any other project.
resource "google_project_iam_member" "spend_cap_unlinks_billing" {
  project = var.project_id
  role    = "roles/billing.projectManager"
  member  = "serviceAccount:${google_service_account.spend_cap.email}"
}

# --- The function --------------------------------------------------------------

resource "google_storage_bucket" "functions_source" {
  project                     = var.project_id
  name                        = "${var.project_id}-functions-src"
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }

  depends_on = [google_project_service.required]
}

data "archive_file" "spend_cap" {
  type        = "zip"
  source_dir  = "${path.module}/spend-cap"
  output_path = "${path.module}/.build/spend-cap.zip"
}

# Named by content hash: a code change uploads a new object, and that is what redeploys the function.
resource "google_storage_bucket_object" "spend_cap" {
  bucket = google_storage_bucket.functions_source.name
  name   = "spend-cap-${data.archive_file.spend_cap.output_md5}.zip"
  source = data.archive_file.spend_cap.output_path
}

# The build runs as our deploy SA (the default compute SA has no roles here, by design — iam.tf).
resource "google_storage_bucket_iam_member" "build_reads_function_source" {
  bucket = google_storage_bucket.functions_source.name
  role   = "roles/storage.objectViewer"
  member = local.build_sa_member
}

# The function service copies that source into ITS OWN bucket, gcf-v2-sources-<number>-<region>, and
# the build reads it from there. That bucket is created by Google on the first deploy, so it cannot be
# granted on directly: this is Google's documented pattern instead — a project-level read scoped by an
# IAM condition to that one bucket. (Without it: "Access to bucket gcf-v2-sources-… denied".)
resource "google_project_iam_member" "build_reads_gcf_sources" {
  project = var.project_id
  role    = "roles/storage.objectViewer"
  member  = local.build_sa_member

  condition {
    title       = "gcf-v2-sources-only"
    description = "Read the Cloud Functions source bucket only (spend cap build)."
    expression  = "resource.name.startsWith(\"projects/_/buckets/gcf-v2-sources-${local.project_number}-${var.region}\")"
  }

  # Project IAM edits race each other (HTTP 409) when applied in parallel.
  depends_on = [
    google_project_iam_member.build_sa_roles,
    google_project_iam_member.spend_cap_unlinks_billing,
  ]
}

resource "google_cloudfunctions2_function" "spend_cap" {
  project     = var.project_id
  location    = var.region
  name        = local.spend_cap_name
  description = "Hard monthly spend cap for ${var.environment}: unlinks billing when the budget is reached."

  build_config {
    runtime         = "nodejs22"
    entry_point     = "capSpend"
    service_account = google_service_account.build.id
    # Our registry, so its cleanup policies keep the function image inside the free tier too.
    docker_repository = google_artifact_registry_repository.images.id

    source {
      storage_source {
        bucket = google_storage_bucket.functions_source.name
        object = google_storage_bucket_object.spend_cap.name
      }
    }
  }

  service_config {
    available_memory      = "256M"
    timeout_seconds       = 60
    max_instance_count    = 1
    min_instance_count    = 0
    ingress_settings      = "ALLOW_INTERNAL_ONLY"
    service_account_email = google_service_account.spend_cap.email

    environment_variables = {
      PROJECT_ID = var.project_id
    }
  }

  event_trigger {
    trigger_region        = var.region
    event_type            = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic          = google_pubsub_topic.spend_cap.id
    retry_policy          = "RETRY_POLICY_RETRY"
    service_account_email = google_service_account.spend_cap.email
  }

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }

  depends_on = [
    google_project_service.required,
    google_storage_bucket_iam_member.build_reads_function_source,
    google_project_iam_member.build_reads_gcf_sources,
    google_project_iam_member.build_sa_roles,
  ]
}

# The Pub/Sub trigger delivers to the function's Cloud Run service (same name as the function) as the
# function's own SA.
resource "google_cloud_run_v2_service_iam_member" "spend_cap_trigger_invokes" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.spend_cap.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.spend_cap.email}"
}
