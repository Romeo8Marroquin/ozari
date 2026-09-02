output "cloud_run_uri" {
  value = module.gcp.cloud_run_uri
}

output "cloud_run_hostname" {
  description = "Read by the prod cloudflare root from remote state — do not remove it."
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
  value = module.gcp.runtime_env_contract
}
