output "api_url" {
  description = "The API's public origin, as the outside world reaches it."
  value       = "https://${var.api_hostname}"
}

output "app_url" {
  description = "The frontend's public origin."
  value       = "https://${var.app_hostname}"
}

output "worker_name" {
  description = "Name of the edge proxy Worker."
  value       = cloudflare_worker.api_proxy.name
}

output "pages_project_name" {
  description = "Cloudflare Pages project name."
  value       = cloudflare_pages_project.app.name
}

output "r2_bucket_name" {
  description = "R2 bucket holding public assets."
  value       = cloudflare_r2_bucket.assets.name
}

output "r2_public_url" {
  description = "Public read base URL for assets — the custom domain when one is configured, otherwise empty (fall back to the bucket's r2.dev URL, which Cloudflare only exposes in the dashboard)."
  value       = var.r2_custom_domain == "" ? "" : "https://${var.r2_custom_domain}"
}
