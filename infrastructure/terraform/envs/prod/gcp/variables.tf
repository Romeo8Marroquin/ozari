# Production's NON-SECRET shape lives here as committed defaults: hostnames, names, sizes. The repo
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
  description = "From secrets/prod.json. Ephemeral: never written to state or to a saved plan."
  type        = map(string)
  ephemeral   = true
  sensitive   = true
}

variable "secret_version_triggers" {
  description = "Rotation counters from secrets/prod.json (`rotation`). Absent key = version 1."
  type        = map(number)
  default     = {}
}

# --- Runtime ------------------------------------------------------------------

variable "node_env" {
  description = "NODE_ENV. 'production' turns /api/docs OFF and stack traces off — a security switch, not a label."
  type        = string
  default     = "production"
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
  description = "Production frontend origin (the apex). No trailing slash."
  type        = string
  default     = "https://partyrentalsgt.com"
}

variable "api_public_url" {
  description = "Production API origin. Shares the registrable domain with app_host so the refresh cookie is first-party."
  type        = string
  default     = "https://api.partyrentalsgt.com"
}

variable "log_level" {
  type    = string
  default = "info"
}

# Must equal the cloudflare root's bucket and custom domain. The public URL is embedded in stored
# image references and printed documents, which is why production gets a brand hostname.
variable "r2_bucket_name" {
  type    = string
  default = "ozari-prod-assets"
}

variable "r2_public_url" {
  type    = string
  default = "https://assets.partyrentalsgt.com"
}

# --- Cloud Run shape (spend controls) -----------------------------------------

variable "min_instances" {
  description = "Keep at 0 unless cold starts become a real complaint — a warm instance bills around the clock."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "The spend cap: the one number that decides how expensive a traffic spike can get. Raise it deliberately."
  type        = number
  default     = 3
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
  default = "ozari-api-prod"
}

variable "build_trigger_branch_regex" {
  description = "Production deploys from main; staging from dev. The triggers live in different projects and cannot fire each other."
  type        = string
  default     = "^main$"
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
  description = "Rollback targets kept regardless of age."
  type        = number
  default     = 3
}

variable "artifact_stale_tagged_seconds" {
  type    = string
  default = "2592000s" # 30 days
}

# --- Optional -------------------------------------------------------------------

variable "enable_cleanup_job" {
  description = "Nightly cleanup:sessions (Cloud Run Job + Scheduler; 3 scheduler jobs are free per billing account). Worth turning on once there are real users — expired sessions and spent reset tokens accumulate with users, not with time."
  type        = bool
  default     = false
}

# From envs/prod/environment.json ("registration_open"), supplied by tf.ps1 — deliberately no
# default, so an apply can never flip sign-up by omission. Change it with
# `infrastructure/scripts/registration.ps1 prod open|close` and commit the file.
variable "registration_open" {
  type = bool
}
