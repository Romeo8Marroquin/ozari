output "project_id" {
  value = google_project.env.project_id
}

output "project_number" {
  description = <<-EOT
    Read by the cloudflare root through remote state: Cloud Run's DETERMINISTIC hostname is
    <service>-<project_number>.<region>.run.app, which is what lets the edge be built before the
    service exists — no copy-paste of a generated URL, and no ordering cycle with the R2 token.
  EOT
  value       = google_project.env.number
}

output "region" {
  value = var.region
}

output "state_bucket" {
  value = google_storage_bucket.tfstate.name
}
