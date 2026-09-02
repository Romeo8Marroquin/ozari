# ---------------------------------------------------------------------------
# IAM.
#
# Everything here is *_iam_member (ADDITIVE) except where explicitly marked authoritative. Additive
# members are idempotent — re-applying one that already exists re-asserts it and touches no other
# member of the policy — which is what lets this config be adopted onto a live project without
# stripping access somebody granted by hand in an emergency.
# ---------------------------------------------------------------------------

locals {
  run_sa_member   = "serviceAccount:${google_service_account.run.email}"
  build_sa_member = "serviceAccount:${google_service_account.build.email}"

  # Cloud Build's Google-managed service agent. It is the identity that reads the GitHub PAT when a
  # 2nd-gen connection is created, which is why it appears here at all.
  cloudbuild_service_agent = "serviceAccount:service-${var.project_number}@gcp-sa-cloudbuild.iam.gserviceaccount.com"
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
# Only relevant when Terraform declares the connection. The Cloud Build SERVICE AGENT (a
# Google-managed identity, not one of ours) reads the PAT, and the connection fails to create
# without this binding.
#
# ⚠️ The agent is created lazily, the first time the Cloud Build API is used in a project. On a
# brand-new project this binding can therefore fail with "service account does not exist" even
# though the API is enabled. If that happens, materialise it once and re-apply:
#
#   gcloud beta services identity create --service=cloudbuild.googleapis.com --project=<project>

resource "google_secret_manager_secret_iam_member" "cloudbuild_agent_reads_github_token" {
  count = var.manage_github_connection ? 1 : 0

  project   = var.project_id
  secret_id = google_secret_manager_secret.this["github_oauth_token"].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.cloudbuild_service_agent

  depends_on = [google_project_service.required]
}

# --- Optional hardening ------------------------------------------------------
#
# ⚠️ AUTHORITATIVE resource. google_project_iam_binding owns the entire member list for the role, so
# this does not "remove the default compute SA" — it declares that NOBODY holds roles/editor. That
# is the intended end state (the runtime is ozari-run-sa, builds are ozari-build-sa, and the human
# owner holds roles/owner, which is a different role), but read the live policy before enabling it:
#
#   gcloud projects get-iam-policy <project> --flatten="bindings[].members" \
#     --filter="bindings.role=roles/editor" --format="value(bindings.members)"
#
# Anything that appears there and is still needed must be moved to a narrower role FIRST.

resource "google_project_iam_binding" "no_project_editors" {
  count = var.revoke_default_compute_sa_editor ? 1 : 0

  project = var.project_id
  role    = "roles/editor"
  members = []
}
