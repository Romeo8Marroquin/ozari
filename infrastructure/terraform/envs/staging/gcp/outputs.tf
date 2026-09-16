output "cloud_run_uri" {
  description = "The service's run.app URL."
  value       = module.gcp.cloud_run_uri
}

output "cloud_run_hostname" {
  description = "Hostname the Cloudflare Worker rewrites Host to. The cloudflare root reads this from remote state — do not remove it."
  value       = module.gcp.cloud_run_hostname
}

output "run_service_account_email" {
  value = module.gcp.run_service_account_email
}

output "build_service_account_email" {
  value = module.gcp.build_service_account_email
}

output "image_url" {
  value = module.gcp.image_url
}

output "managed_secret_ids" {
  value = module.gcp.managed_secret_ids
}

output "runtime_env_contract" {
  description = "What the service is configured with — the same strings Cloud Build is handed. Secret values are not included, only which secret backs which variable."
  value       = module.gcp.runtime_env_contract
}
