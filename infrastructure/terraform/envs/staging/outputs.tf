output "cloud_run_service_name" {
  description = "Cloud Run service name."
  value       = google_cloud_run_v2_service.ozari_api.name
}

output "cloud_run_service_uri" {
  description = "Public URL of the Cloud Run service."
  value       = google_cloud_run_v2_service.ozari_api.uri
}

output "run_service_account_email" {
  description = "Cloud Run runtime service account email."
  value       = google_service_account.run.email
}

output "build_service_account_email" {
  description = "Cloud Build deploy service account email."
  value       = google_service_account.build.email
}

output "artifact_registry_repository" {
  description = "Artifact Registry repository resource name."
  value       = google_artifact_registry_repository.ozari_images.id
}

output "build_trigger_id" {
  description = "Cloud Build trigger ID."
  value       = google_cloudbuild_trigger.ozari_api_dev.trigger_id
}

output "managed_secret_ids" {
  description = "Secret Manager secret containers managed by Terraform."
  value = [
    google_secret_manager_secret.ozari_database_url.secret_id,
    google_secret_manager_secret.ozari_direct_database_url.secret_id,
    google_secret_manager_secret.ozari_jwt_secret.secret_id,
    google_secret_manager_secret.ozari_jwt_refresh_secret.secret_id,
    google_secret_manager_secret.ozari_encryption_key.secret_id,
    google_secret_manager_secret.ozari_api_key.secret_id,
  ]
}
