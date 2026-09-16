# ---------------------------------------------------------------------------
# State moves: flat root (first adoption pass) → the shared `gcp-env` module.
#
# These are pure bookkeeping — they tell Terraform that an existing object now lives at a new
# address. No API call is made for a move. Without them Terraform would read the old addresses as
# "gone" and the new ones as "not there yet", and plan a DESTROY of live staging followed by a
# recreate, which for the Cloud Run service and the secret containers is exactly the outage this
# file exists to prevent.
#
# A `moved` block whose source address is not in state is a no-op, so this file is harmless to keep
# after the move has been applied, and harmless in a from-scratch environment.
# ---------------------------------------------------------------------------

moved {
  from = google_service_account.run
  to   = module.gcp.google_service_account.run
}

moved {
  from = google_service_account.build
  to   = module.gcp.google_service_account.build
}

moved {
  from = google_artifact_registry_repository.ozari_images
  to   = module.gcp.google_artifact_registry_repository.images
}

moved {
  from = google_cloud_run_v2_service.ozari_api
  to   = module.gcp.google_cloud_run_v2_service.api
}

moved {
  from = google_cloud_run_v2_service_iam_member.public_invoker
  to   = module.gcp.google_cloud_run_v2_service_iam_member.public_invoker
}

moved {
  from = google_cloudbuild_trigger.ozari_api_dev
  to   = module.gcp.google_cloudbuild_trigger.deploy
}

# --- Secret containers: individual resources → one for_each map ---------------

moved {
  from = google_secret_manager_secret.ozari_database_url
  to   = module.gcp.google_secret_manager_secret.this["database_url"]
}

moved {
  from = google_secret_manager_secret.ozari_direct_database_url
  to   = module.gcp.google_secret_manager_secret.this["direct_database_url"]
}

moved {
  from = google_secret_manager_secret.ozari_jwt_secret
  to   = module.gcp.google_secret_manager_secret.this["jwt_secret"]
}

moved {
  from = google_secret_manager_secret.ozari_jwt_refresh_secret
  to   = module.gcp.google_secret_manager_secret.this["jwt_refresh_secret"]
}

moved {
  from = google_secret_manager_secret.ozari_encryption_key
  to   = module.gcp.google_secret_manager_secret.this["encryption_key"]
}

moved {
  from = google_secret_manager_secret.ozari_api_key
  to   = module.gcp.google_secret_manager_secret.this["api_key"]
}

moved {
  from = google_secret_manager_secret.ozari_email_key
  to   = module.gcp.google_secret_manager_secret.this["email_key"]
}

moved {
  from = google_secret_manager_secret.ozari_r2_access_key
  to   = module.gcp.google_secret_manager_secret.this["r2_access_key"]
}

moved {
  from = google_secret_manager_secret.ozari_r2_secret_key
  to   = module.gcp.google_secret_manager_secret.this["r2_secret_key"]
}

moved {
  from = google_secret_manager_secret.ozari_google_client_id
  to   = module.gcp.google_secret_manager_secret.this["google_client_id"]
}

moved {
  from = google_secret_manager_secret.ozari_google_client_secret
  to   = module.gcp.google_secret_manager_secret.this["google_client_secret"]
}

# --- Secret IAM: same keys, new resource names -------------------------------

moved {
  from = google_secret_manager_secret_iam_member.run_sa_secret_access
  to   = module.gcp.google_secret_manager_secret_iam_member.run_sa
}

moved {
  from = google_secret_manager_secret_iam_member.build_sa_secret_access
  to   = module.gcp.google_secret_manager_secret_iam_member.build_sa
}

# --- Project roles: three named resources → one for_each over the role list ---

moved {
  from = google_project_iam_member.build_sa_artifactregistry_writer
  to   = module.gcp.google_project_iam_member.build_sa_roles["roles/artifactregistry.writer"]
}

moved {
  from = google_project_iam_member.build_sa_run_admin
  to   = module.gcp.google_project_iam_member.build_sa_roles["roles/run.admin"]
}

moved {
  from = google_project_iam_member.build_sa_log_writer
  to   = module.gcp.google_project_iam_member.build_sa_roles["roles/logging.logWriter"]
}

moved {
  from = google_project_service.required
  to   = module.gcp.google_project_service.required
}
