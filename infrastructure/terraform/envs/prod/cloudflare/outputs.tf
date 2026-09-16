output "api_url" {
  value = module.cloudflare.api_url
}

output "app_url" {
  value = module.cloudflare.app_url
}

output "r2_public_url" {
  description = "Feed this back into the gcp root's r2_public_url so the API hands out the same base URL it stores."
  value       = module.cloudflare.r2_public_url
}
