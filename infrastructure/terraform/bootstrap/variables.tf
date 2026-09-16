variable "project_id" {
  description = "Globally-unique project ID to create (e.g. ozari-prod). Cannot be changed afterwards."
  type        = string
}

variable "project_name" {
  description = "Human-readable project name shown in the console."
  type        = string
  default     = "Ozari Production"
}

variable "billing_account" {
  description = <<-EOT
    Billing account ID to link, in the form XXXXXX-XXXXXX-XXXXXX.

    Find it with `gcloud billing accounts list`. It is not a secret, but it identifies your payment
    setup, so it lives in the gitignored terraform.tfvars rather than in the repo.
  EOT
  type        = string
}

variable "environment" {
  description = "Label applied to the project and bucket."
  type        = string
  default     = "production"
}

variable "region" {
  type    = string
  default = "northamerica-south1"
}

variable "state_bucket_name" {
  description = "Globally-unique name for this environment's Terraform state bucket. Must match the `backend` block in envs/<env>/*/main.tf."
  type        = string
}

variable "state_bucket_location" {
  description = "Bucket location. A regional bucket next to the project's resources is cheapest and sufficient — state is read by humans, not by traffic."
  type        = string
  default     = "northamerica-south1"
}
