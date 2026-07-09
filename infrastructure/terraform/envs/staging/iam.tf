# IAM bindings.
#
# All bindings below use *_iam_member (additive). Additive members are idempotent at
# the API level: applying a member that already exists simply re-asserts it and does
# NOT clobber other members of the policy. We deliberately do NOT use
# google_*_iam_policy / google_*_iam_binding (authoritative) so adoption can't strip
# pre-existing access. Importing additive members is optional; see imports.tf for the
# optional import commands. If you skip the import, the first apply "creates" them,
# which just re-asserts the existing membership (no-op effect).

# ---------------------------------------------------------------------------
# Secret access for the Cloud Run runtime SA (ozari-run-sa)
#   ozari-database-url, ozari-jwt-secret, ozari-jwt-refresh-secret,
#   ozari-encryption-key, ozari-api-key
# ---------------------------------------------------------------------------
locals {
  run_sa_member   = "serviceAccount:${google_service_account.run.email}"
  build_sa_member = "serviceAccount:${google_service_account.build.email}"

  run_sa_accessible_secrets = {
    database_url       = google_secret_manager_secret.ozari_database_url.secret_id
    jwt_secret         = google_secret_manager_secret.ozari_jwt_secret.secret_id
    jwt_refresh_secret = google_secret_manager_secret.ozari_jwt_refresh_secret.secret_id
    encryption_key     = google_secret_manager_secret.ozari_encryption_key.secret_id
    api_key            = google_secret_manager_secret.ozari_api_key.secret_id
    email_key          = google_secret_manager_secret.ozari_email_key.secret_id
    r2_access_key      = google_secret_manager_secret.ozari_r2_access_key.secret_id
    r2_secret_key      = google_secret_manager_secret.ozari_r2_secret_key.secret_id
  }

  # Cloud Build (ozari-build-sa) needs DB URLs for the migration step.
  build_sa_accessible_secrets = {
    database_url        = google_secret_manager_secret.ozari_database_url.secret_id
    direct_database_url = google_secret_manager_secret.ozari_direct_database_url.secret_id
  }
}

resource "google_secret_manager_secret_iam_member" "run_sa_secret_access" {
  for_each = local.run_sa_accessible_secrets

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = local.run_sa_member
}

resource "google_secret_manager_secret_iam_member" "build_sa_secret_access" {
  for_each = local.build_sa_accessible_secrets

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = local.build_sa_member
}

# ---------------------------------------------------------------------------
# Project-level roles for the Cloud Build deploy SA (ozari-build-sa).
# Narrowly scoped, additive. These already exist on the project; managing them here
# documents the contract and keeps them from drifting.
# ---------------------------------------------------------------------------
resource "google_project_iam_member" "build_sa_artifactregistry_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = local.build_sa_member
}

resource "google_project_iam_member" "build_sa_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = local.build_sa_member
}

resource "google_project_iam_member" "build_sa_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = local.build_sa_member
}

# NOTE: Cloud Build's deploy SA also needs to act as the runtime SA to deploy Cloud Run
# (roles/iam.serviceAccountUser on ozari-run-sa). That binding exists today out-of-band;
# we leave it unmanaged in this first pass to avoid touching SA-scoped IAM. See README
# hardening TODOs.

# ---------------------------------------------------------------------------
# Hardening TODOs (DO NOT change in this first adoption pass — documented only):
#   - default compute service account has roles/editor (over-privileged) -> remove.
#   - Cloud Build service agent has roles/secretmanager.admin -> scope down to
#     secretAccessor on specific secrets.
#   - user romeo11marroquin@gmail.com has roles/owner -> expected for the project owner.
# These existing bindings are intentionally NOT managed/removed here.
# ---------------------------------------------------------------------------
