output "cloud_run_service_name" {
  description = "Cloud Run service name."
  value       = google_cloud_run_v2_service.api.name
}

output "cloud_run_uri" {
  description = "The service's own https://<service>-<hash>.<region>.run.app URL."
  value       = google_cloud_run_v2_service.api.uri
}

output "cloud_run_hostname" {
  description = <<-EOT
    The run.app hostname with no scheme — exactly what the Cloudflare Worker rewrites `Host` to.
    Exposed so the Cloudflare module can consume it directly: this dependency used to be a
    chicken-and-egg step in the runbook ("record the generated URL after the first deploy, then go
    paste it into a Worker"), and as a module output Terraform simply orders it.
  EOT
  value       = replace(google_cloud_run_v2_service.api.uri, "https://", "")
}

output "run_service_account_email" {
  description = "Cloud Run runtime service account."
  value       = google_service_account.run.email
}

output "build_service_account_email" {
  description = "Cloud Build deploy service account."
  value       = google_service_account.build.email
}

output "artifact_registry_repository" {
  description = "Artifact Registry repository resource name."
  value       = google_artifact_registry_repository.images.id
}

output "image_url" {
  description = "Fully-qualified image path (no tag)."
  value       = local.image_url
}

output "build_trigger_id" {
  description = "Cloud Build trigger ID."
  value       = google_cloudbuild_trigger.deploy.trigger_id
}

output "managed_secret_ids" {
  description = "Secret Manager containers this module owns."
  value       = [for key, cfg in local.secrets : cfg.secret_id]
}

output "runtime_env_contract" {
  description = <<-EOT
    What the service is actually configured with — the same strings handed to Cloud Build. Useful in
    review: `terraform output runtime_env_contract` answers "what env does prod have?" without
    opening a console. Secret VALUES are not here; only which secret backs which variable.
  EOT
  value = {
    env_vars = local.set_env_vars_arg
    secrets  = local.set_secrets_arg
  }
}
