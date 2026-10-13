# Staging's NON-SECRET shape lives here as committed defaults: hostnames, names, sizes. The repo
# carries the shape of an environment; values that identify an account or are secret arrive from
# tf.ps1 (see main.tf).

# --- Supplied by tf.ps1 -------------------------------------------------------

variable "project_id" {
  description = "From ../environment.json."
  type        = string
}

variable "region" {
  description = "From ../environment.json."
  type        = string
}

variable "cloudflare_account_id" {
  description = "From secrets/account.json. Used only to derive the R2 S3 endpoint."
  type        = string
}

variable "github_app_installation_id" {
  description = "From secrets/account.json."
  type        = string
}

variable "secret_values" {
  description = "From secrets/staging.json. Ephemeral: never written to state or to a saved plan."
  type        = map(string)
  ephemeral   = true
  sensitive   = true
}

variable "secret_version_triggers" {
  description = "Rotation counters from secrets/staging.json (`rotation`). Absent key = version 1."
  type        = map(number)
  default     = {}
}

# --- Runtime ------------------------------------------------------------------

variable "node_env" {
  description = "NODE_ENV. 'staging' keeps /api/docs on and turns audit logging on."
  type        = string
  default     = "staging"
}

variable "service_name" {
  type    = string
  default = "ozari-api"
}

variable "artifact_repository_id" {
  type    = string
  default = "ozari-images"
}

variable "image_name" {
  type    = string
  default = "ozari-api"
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

# Must equal the cloudflare root's bucket and custom domain — the API signs uploads for the bucket it
# is told about, and builds public image URLs from the domain.
variable "r2_bucket_name" {
  type    = string
  default = "ozari-staging-assets"
}

variable "r2_public_url" {
  type    = string
  default = "https://assets-stg.partyrentalsgt.com"
}

# --- Cloud Run shape (spend controls) -----------------------------------------

variable "min_instances" {
  description = "Keep at 0. Scale-to-zero is the reason an idle environment costs nothing."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "The spend cap. Staging never needs more than a couple."
  type        = number
  default     = 2
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

# --- Cloud Build ----------------------------------------------------------------

variable "build_trigger_name" {
  type    = string
  default = "ozari-api-staging"
}

variable "build_trigger_branch_regex" {
  type    = string
  default = "^dev$"
}

variable "github_owner" {
  type    = string
  default = "Romeo8Marroquin"
}

variable "github_repo_name" {
  type    = string
  default = "ozari"
}

variable "artifact_keep_count" {
  type    = number
  default = 2
}

variable "artifact_stale_tagged_seconds" {
  type    = string
  default = "1209600s" # 14 days
}

# --- Optional -------------------------------------------------------------------

variable "enable_cleanup_job" {
  description = "Nightly cleanup:sessions. Housekeeping, not correctness — off on staging."
  type        = bool
  default     = false
}

# From envs/staging/environment.json ("registration_open"), supplied by tf.ps1 — deliberately no
# default, so an apply can never flip sign-up by omission. Change it with
# `infrastructure/scripts/registration.ps1 staging open|close` and commit the file.
variable "registration_open" {
  type = bool
}
