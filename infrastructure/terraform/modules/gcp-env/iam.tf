# ---------------------------------------------------------------------------
# IAM.
#
# Everything here is *_iam_member (ADDITIVE) — or its surgical inverse, *_iam_member_remove. Nothing
# is authoritative: re-applying a member re-asserts it and touches no other member of the policy, so
# an emergency grant made by hand is never silently stripped by the next apply.
# ---------------------------------------------------------------------------

locals {
  run_sa_member   = "serviceAccount:${google_service_account.run.email}"
  build_sa_member = "serviceAccount:${google_service_account.build.email}"

  # Cloud Build's Google-managed service agent. It is the identity that reads the GitHub PAT when a
  # 2nd-gen connection is created, which is why it appears here at all.
  cloudbuild_service_agent = "serviceAccount:service-${local.project_number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"

  default_compute_sa = "serviceAccount:${local.project_number}-compute@developer.gserviceaccount.com"
}

# --- Secret access, derived from the registry in secrets.tf ------------------

resource "google_secret_manager_secret_iam_member" "run_sa" {
  for_each = local.run_accessible_secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.this[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.run_sa_member
}

resource "google_secret_manager_secret_iam_member" "build_sa" {
  for_each = local.build_accessible_secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.this[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.build_sa_member
}

# --- The deploy SA's project roles ------------------------------------------

resource "google_project_iam_member" "build_sa_roles" {
  for_each = toset([
    "roles/artifactregistry.writer", # push the image
    "roles/run.admin",               # deploy the service
    "roles/logging.logWriter",       # write its own build logs
  ])

  project = var.project_id
  role    = each.value
  member  = local.build_sa_member
}

# Deploying a Cloud Run service that RUNS AS another service account requires acting as it. This was
# granted out-of-band on staging and left unmanaged in the first adoption pass; declaring it here is
# what makes a from-scratch environment actually deploy on its first build instead of failing with a
# permission error three steps in.
resource "google_service_account_iam_member" "build_sa_acts_as_run_sa" {
  service_account_id = google_service_account.run.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.build_sa_member
}

# --- The GitHub connection's credential --------------------------------------
# The Cloud Build SERVICE AGENT (a Google-managed identity, not one of ours) reads the PAT, and the
# connection fails to create without this binding.
#
# The agent is created lazily, the first time the Cloud Build API is used in a project, so on a
# brand-new project the binding could race it and fail with "service account does not exist".
# `google_project_service_identity` materialises it explicitly — the old runbook step
# ("run `gcloud beta services identity create` and re-apply") is an edge in the graph now.

resource "google_project_service_identity" "cloudbuild" {
  provider = google-beta

  project = var.project_id
  service = "cloudbuild.googleapis.com"

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "cloudbuild_agent_reads_github_token" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.this["github_oauth_token"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.cloudbuild_service_agent

  depends_on = [google_project_service_identity.cloudbuild]
}

# --- Hardening ---------------------------------------------------------------
# On some projects Google grants the default compute service account roles/editor the moment the
# Compute API comes up (enabling Cloud Run can bring it). Nothing here runs as that account. This
# removes exactly that one member from exactly that one role — unlike an iam_binding, it cannot
# strip anything else, and it is a no-op when the grant was never made.

resource "google_project_iam_member_remove" "default_compute_sa_editor" {
  count = var.revoke_default_compute_sa_editor ? 1 : 0

  project = var.project_id
  role    = "roles/editor"
  member  = local.default_compute_sa

  # After the project-level grants, never beside them: both read-modify-write the SAME project policy,
  # and run in parallel they collide ("Error 409: There were concurrent policy changes").
  depends_on = [
    google_project_service.required,
    google_project_iam_member.build_sa_roles,
  ]
}
