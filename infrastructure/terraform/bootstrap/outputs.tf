output "project_id" {
  description = "Feed into envs/prod/gcp/terraform.tfvars."
  value       = google_project.env.project_id
}

output "project_number" {
  description = "Feed into envs/prod/gcp/terraform.tfvars — the gcp-env module needs it for the Cloud Build service-agent member string."
  value       = google_project.env.number
}

output "state_bucket" {
  description = "Must match the `backend \"gcs\"` bucket in envs/prod/*/main.tf. Terraform cannot read a variable in a backend block, so this one value is duplicated by hand — check it."
  value       = google_storage_bucket.tfstate.name
}
