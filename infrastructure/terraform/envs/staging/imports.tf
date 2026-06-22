# Terraform 1.5+ import blocks for adopting EXISTING staging resources into state.
# These tell Terraform "this config maps to that live resource" — `terraform plan`
# will then show the adoption (import) plus any config drift, WITHOUT creating
# duplicates. Review the plan carefully before apply.
#
# After the first successful `terraform apply` adopts everything, you may remove this
# file (the resources stay in state). Keeping it is harmless — imports are no-ops once
# the resource is already in state.
#
# IDs use provider-correct, literal formats (import blocks resolve before var eval, so
# we use literal values matching terraform.tfvars.example).

import {
  to = google_service_account.run
  id = "projects/ozari-500103/serviceAccounts/ozari-run-sa@ozari-500103.iam.gserviceaccount.com"
}

import {
  to = google_service_account.build
  id = "projects/ozari-500103/serviceAccounts/ozari-build-sa@ozari-500103.iam.gserviceaccount.com"
}

import {
  to = google_artifact_registry_repository.ozari_images
  id = "projects/ozari-500103/locations/northamerica-south1/repositories/ozari-images"
}

import {
  to = google_secret_manager_secret.ozari_database_url
  id = "projects/ozari-500103/secrets/ozari-database-url"
}

import {
  to = google_secret_manager_secret.ozari_direct_database_url
  id = "projects/ozari-500103/secrets/ozari-direct-database-url"
}

import {
  to = google_secret_manager_secret.ozari_jwt_secret
  id = "projects/ozari-500103/secrets/ozari-jwt-secret"
}

import {
  to = google_secret_manager_secret.ozari_jwt_refresh_secret
  id = "projects/ozari-500103/secrets/ozari-jwt-refresh-secret"
}

import {
  to = google_secret_manager_secret.ozari_encryption_key
  id = "projects/ozari-500103/secrets/ozari-encryption-key"
}

import {
  to = google_secret_manager_secret.ozari_api_key
  id = "projects/ozari-500103/secrets/ozari-api-key"
}

import {
  to = google_cloud_run_v2_service.ozari_api
  id = "projects/ozari-500103/locations/northamerica-south1/services/ozari-api"
}

import {
  to = google_cloudbuild_trigger.ozari_api_dev
  id = "projects/ozari-500103/locations/northamerica-south1/triggers/de0caa3a-2deb-4ea1-8978-cb795027f468"
}

# ---------------------------------------------------------------------------
# IAM MEMBER resources (additive) — NOT imported via blocks on purpose.
#
# Additive *_iam_member resources are idempotent: applying one that already exists just
# re-asserts the membership (no other members are touched), so a clean adoption does NOT
# require importing them. The first `terraform plan` will show them as "to create";
# that is expected and safe.
#
# If you prefer them tracked as imported (cleaner state), run these AFTER the main
# import/apply (member IDs are space-separated: "<resource> <role> <member>"):
#
#   terraform import 'google_secret_manager_secret_iam_member.run_sa_secret_access["database_url"]' \
#     "projects/ozari-500103/secrets/ozari-database-url roles/secretmanager.secretAccessor serviceAccount:ozari-run-sa@ozari-500103.iam.gserviceaccount.com"
#   terraform import 'google_secret_manager_secret_iam_member.run_sa_secret_access["jwt_secret"]' \
#     "projects/ozari-500103/secrets/ozari-jwt-secret roles/secretmanager.secretAccessor serviceAccount:ozari-run-sa@ozari-500103.iam.gserviceaccount.com"
#   terraform import 'google_secret_manager_secret_iam_member.run_sa_secret_access["jwt_refresh_secret"]' \
#     "projects/ozari-500103/secrets/ozari-jwt-refresh-secret roles/secretmanager.secretAccessor serviceAccount:ozari-run-sa@ozari-500103.iam.gserviceaccount.com"
#   terraform import 'google_secret_manager_secret_iam_member.run_sa_secret_access["encryption_key"]' \
#     "projects/ozari-500103/secrets/ozari-encryption-key roles/secretmanager.secretAccessor serviceAccount:ozari-run-sa@ozari-500103.iam.gserviceaccount.com"
#   terraform import 'google_secret_manager_secret_iam_member.run_sa_secret_access["api_key"]' \
#     "projects/ozari-500103/secrets/ozari-api-key roles/secretmanager.secretAccessor serviceAccount:ozari-run-sa@ozari-500103.iam.gserviceaccount.com"
#
#   terraform import 'google_secret_manager_secret_iam_member.build_sa_secret_access["database_url"]' \
#     "projects/ozari-500103/secrets/ozari-database-url roles/secretmanager.secretAccessor serviceAccount:ozari-build-sa@ozari-500103.iam.gserviceaccount.com"
#   terraform import 'google_secret_manager_secret_iam_member.build_sa_secret_access["direct_database_url"]' \
#     "projects/ozari-500103/secrets/ozari-direct-database-url roles/secretmanager.secretAccessor serviceAccount:ozari-build-sa@ozari-500103.iam.gserviceaccount.com"
#
#   terraform import google_project_iam_member.build_sa_artifactregistry_writer \
#     "ozari-500103 roles/artifactregistry.writer serviceAccount:ozari-build-sa@ozari-500103.iam.gserviceaccount.com"
#   terraform import google_project_iam_member.build_sa_run_admin \
#     "ozari-500103 roles/run.admin serviceAccount:ozari-build-sa@ozari-500103.iam.gserviceaccount.com"
#   terraform import google_project_iam_member.build_sa_log_writer \
#     "ozari-500103 roles/logging.logWriter serviceAccount:ozari-build-sa@ozari-500103.iam.gserviceaccount.com"
#
#   terraform import google_cloud_run_v2_service_iam_member.public_invoker \
#     "projects/ozari-500103/locations/northamerica-south1/services/ozari-api roles/run.invoker allUsers"
#
# The google_project_service.required[*] resources are also not imported; enabling an
# already-enabled API is a no-op.
# ---------------------------------------------------------------------------
