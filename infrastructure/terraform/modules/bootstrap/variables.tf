variable "environment" {
  description = "Logical environment name (staging | production). Labels only."
  type        = string
}

variable "project_id" {
  description = "Globally-unique project ID to create. Cannot be changed afterwards. Comes from envs/<env>/environment.json."
  type        = string
}

variable "project_name" {
  description = "Human-readable project name shown in the console."
  type        = string
}

variable "billing_account" {
  description = <<-EOT
    Billing account ID to link, in the form XXXXXX-XXXXXX-XXXXXX (`gcloud billing accounts list`).
    Not a secret, but it identifies your payment setup, so it lives in the gitignored
    infrastructure/secrets/account.json and reaches Terraform as TF_VAR_billing_account.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.billing_account))
    error_message = "billing_account must look like XXXXXX-XXXXXX-XXXXXX. Fill it with: ./infrastructure/scripts/secret.ps1 account billing_account"
  }
}

variable "region" {
  description = "Location of the state bucket — the environment's region."
  type        = string
}

variable "state_bucket_name" {
  description = "Globally-unique name of the state bucket. Must equal state_bucket in envs/<env>/environment.json, which tf.ps1 feeds to every backend."
  type        = string
}
