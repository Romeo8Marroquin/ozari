output "api_url" {
  value = module.cloudflare.api_url
}

output "app_url" {
  value = module.cloudflare.app_url
}

output "worker_name" {
  value = module.cloudflare.worker_name
}

output "worker_target" {
  description = "The Cloud Run hostname the Worker forwards to."
  value       = local.cloud_run_hostname
}

output "pages_project_name" {
  value = module.cloudflare.pages_project_name
}

output "pages_subdomain" {
  value = module.cloudflare.pages_subdomain
}

output "r2_bucket_name" {
  value = module.cloudflare.r2_bucket_name
}

output "r2_public_url" {
  value = module.cloudflare.r2_public_url
}
