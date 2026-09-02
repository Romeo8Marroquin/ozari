# Production has NO defaults for identity. An empty-defaulted project id is how an apply meant for
# production lands somewhere else; making it required means the mistake is a plan-time error rather
# than a deployed surprise.

variable "project_id" {
  description = "Production GCP project ID (created by infrastructure/terraform/bootstrap)."
  type        = string
}

variable "project_number" {
  description = "Production GCP project number. Output by the bootstrap root; needed for the Cloud Build service-agent member string."
  type        = string
}

variable "region" {
  description = "Region. Keep it identical to staging unless you have measured a reason: changing it changes Cloud Run's URL, the Worker target and the latency to Neon."
  type        = string
  default     = "northamerica-south1"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "node_env" {
  description = "NODE_ENV. 'production' is what turns /api/docs OFF and stack traces off — it is a security switch, not a label."
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

variable "min_instances" {
  description = "Keep at 0 unless cold starts become a real complaint — a warm instance bills around the clock."
  type        = number
  default     = 0
}

variable "app_host" {
  description = "Production frontend origin. No trailing slash."
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
  description = "The spend cap. Raise it deliberately: this is the one number that decides how expensive a traffic spike can get."
  type        = number
  default     = 5
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
  description = "Production secret payloads, from the gitignored secrets.auto.tfvars. Ephemeral: never written to state."
  type        = map(string)
  ephemeral   = true
  sensitive   = true
}

variable "secret_version_triggers" {
  type    = map(number)
  default = {}
}

# --- Cloud Build ------------------------------------------------------------

variable "build_trigger_name" {
  type    = string
  default = "ozari-api-prod"
}

variable "build_trigger_branch_regex" {
  description = "Production deploys from main. Staging deploys from dev. The two triggers live in different projects and cannot fire each other."
  type        = string
  default     = "^main$"
}

variable "github_connection_name" {
  type    = string
  default = "ozari-github"
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
  description = "Cloud Build GitHub App installation id. From github.com → Settings → Applications → Google Cloud Build → Configure (it is the number in the URL)."
  type        = string
}

variable "github_oauth_token_secret_id" {
  description = "Secret Manager secret holding a GitHub PAT with REPO_ADMIN scope. Create the container and load the value the same way as any other secret."
  type        = string
  default     = "ozari-github-oauth-token"
}

# --- Registry ---------------------------------------------------------------

variable "artifact_keep_count" {
  type    = number
  default = 2
}

variable "artifact_stale_tagged_seconds" {
  type    = string
  default = "1209600s" # 14 days
}

# --- Optional ---------------------------------------------------------------

variable "enable_cleanup_job" {
  description = "Worth turning on in production once there is real traffic — expired sessions and spent reset tokens accumulate with users, not with time."
  type        = bool
  default     = false
}

variable "revoke_default_compute_sa_editor" {
  description = "Safe to leave true on a project Terraform created: nothing there legitimately holds roles/editor."
  type        = bool
  default     = true
}
