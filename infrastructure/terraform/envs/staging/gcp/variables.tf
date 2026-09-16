# Defaults are staging's source of truth for NON-SECRET configuration, so a plan works without a
# terraform.tfvars. They are all public identifiers (project id, hostnames, sizes) and are committed
# deliberately: the repo carries the SHAPE of an environment. Anything genuinely secret is in
# secrets.auto.tfvars, which is gitignored.

variable "project_id" {
  type    = string
  default = "ozari-500103"
}

variable "project_number" {
  type    = string
  default = "694756660984"
}

variable "region" {
  type    = string
  default = "northamerica-south1"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "node_env" {
  description = "NODE_ENV. Staging runs 'staging', which is what gates /api/docs on and audit logging on."
  type        = string
  default     = "staging"
}

variable "service_name" {
  description = "Staging's Cloud Run service is named ozari-api. Do NOT rename it to ozari-api-staging — the name is referenced by the trigger, the docs and every runbook."
  type        = string
  default     = "ozari-api"
}

variable "artifact_repository_id" {
  type    = string
  default = "ozari-images"
}

variable "image_name" {
  type    = string
  default = "ozari-api"
}

variable "min_instances" {
  description = "Keep at 0. Scale-to-zero is the reason an idle environment costs nothing."
  type        = number
  default     = 0
}

variable "app_host" {
  type    = string
  default = "https://staging.partyrentalsgt.com"
}

variable "api_public_url" {
  type    = string
  default = "https://api-staging.partyrentalsgt.com"
}

variable "log_level" {
  type    = string
  default = "info"
}

# R2 identifiers name your account and bucket, so they stay out of the public repo and live in the
# gitignored terraform.tfvars. Empty is harmless until an upload is attempted.
variable "r2_endpoint" {
  type    = string
  default = ""
}

variable "r2_bucket_name" {
  type    = string
  default = ""
}

variable "r2_public_url" {
  type    = string
  default = ""
}

variable "max_instances" {
  type    = number
  default = 3
}

variable "concurrency" {
  type    = number
  default = 40
}

variable "timeout_seconds" {
  type    = number
  default = 60
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

# --- Secrets ----------------------------------------------------------------

variable "secret_values" {
  description = "Secret payloads, from the gitignored secrets.auto.tfvars. Ephemeral: never written to state or to a saved plan."
  type        = map(string)
  ephemeral   = true
  sensitive   = true
}

variable "secret_version_triggers" {
  description = "Rotation counters. Bump a key here (and supply the new value) to push a new Secret Manager version; the superseded version is destroyed with it."
  type        = map(number)
  default     = {}
}

# --- Cloud Build ------------------------------------------------------------

variable "build_trigger_name" {
  type    = string
  default = "ozari-api-dev"
}

variable "build_trigger_branch_regex" {
  type    = string
  default = "^dev$"
}

variable "manage_github_connection" {
  description = "false until the staging rebuild — see the note in main.tf."
  type        = bool
  default     = false
}

variable "github_repository_resource" {
  type    = string
  default = "projects/ozari-500103/locations/northamerica-south1/connections/ozari-github/repositories/Romeo8Marroquin-ozari"
}

variable "github_owner" {
  type    = string
  default = "Romeo8Marroquin"
}

variable "github_repo_name" {
  type    = string
  default = "ozari"
}

variable "github_app_installation_id" {
  description = "Only needed when manage_github_connection = true. Not a secret (it is an installation number), but it is per-account, so it lives in terraform.tfvars."
  type        = string
  default     = ""
}

# --- Optional ---------------------------------------------------------------

variable "enable_cleanup_job" {
  type    = bool
  default = false
}

variable "revoke_default_compute_sa_editor" {
  description = "⚠️ Authoritative IAM. Read the warning in modules/gcp-env/iam.tf before setting true."
  type        = bool
  default     = false
}
