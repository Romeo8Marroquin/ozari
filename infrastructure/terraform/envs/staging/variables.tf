# Variable defaults are set to current staging reality so `terraform plan` works
# even without a terraform.tfvars. Override per-value in terraform.tfvars (gitignored)
# if needed; terraform.tfvars.example documents the canonical values.

variable "project_id" {
  description = "GCP project ID."
  type        = string
  default     = "ozari-500103"
}

variable "project_number" {
  description = "GCP project number (used for IAM and resource paths)."
  type        = string
  default     = "694756660984"
}

variable "region" {
  description = "Primary GCP region for all regional resources."
  type        = string
  default     = "northamerica-south1"
}

variable "environment" {
  description = "Logical environment name."
  type        = string
  default     = "staging"
}

variable "service_name" {
  description = "Cloud Run service name. Staging is 'ozari-api' (do NOT rename to ozari-api-staging)."
  type        = string
  default     = "ozari-api"
}

variable "app_host" {
  # Staging's frontend is served from its own subdomain so the refresh cookie is FIRST-party with
  # the API (`api-staging.` — same registrable domain), which is what keeps sessions alive on
  # Safari/iOS. Changing it here means changing `cloudbuild.yaml`'s `_APP_HOST` fallback and the
  # frontend CSP `connect-src` in the same commit (DEPLOYMENT.md §3c).
  description = "Allowed frontend origin (APP_HOST env var). No trailing slash."
  type        = string
  default     = "https://staging.partyrentalsgt.com"
}

variable "api_public_url" {
  # The API's OWN origin, as the outside world reaches it. Staging sits behind a Cloudflare Worker
  # that rewrites the Host header to the run.app name (DEPLOYMENT.md §3c), so the API cannot derive
  # this from a request — and it is what the calendar's OAuth redirect URI and the ICS feed URL are
  # built from (an admin pastes the latter into their phone). Keep it identical to cloudbuild.yaml's
  # `_API_PUBLIC_URL`. Empty = derive from the request, which is right only with no proxy in front.
  description = "The API's public origin (API_PUBLIC_URL env var). No trailing slash."
  type        = string
  default     = "https://api-staging.partyrentalsgt.com"
}

variable "node_env" {
  description = "NODE_ENV runtime value."
  type        = string
  default     = "staging"
}

variable "log_level" {
  description = "LOG_LEVEL runtime value."
  type        = string
  default     = "info"
}

# --- Cloudflare R2 (plain, NON-secret runtime env). Env-specific + semi-sensitive (bucket/account),
#     so defaults are empty here — set real values in the gitignored terraform.tfvars (never in this
#     public repo). Empty is harmless until the storage helper is actually used (Epic 1). The R2
#     CREDENTIALS (access/secret key) are NOT here — they are Secret Manager secrets (secrets.tf). ---
variable "r2_endpoint" {
  description = "Cloudflare R2 S3 API endpoint, https://<account-id>.r2.cloudflarestorage.com (R2_ENDPOINT)."
  type        = string
  default     = ""
}

variable "r2_bucket_name" {
  description = "Cloudflare R2 bucket name for public assets (R2_BUCKET_NAME)."
  type        = string
  default     = ""
}

variable "r2_public_url" {
  description = "Public read base URL for R2 assets — r2.dev or a custom domain, no trailing slash (R2_PUBLIC_URL)."
  type        = string
  default     = ""
}

variable "artifact_repository_id" {
  description = "Artifact Registry Docker repository ID."
  type        = string
  default     = "ozari-images"
}

variable "image_name" {
  description = "Container image name within the Artifact Registry repository."
  type        = string
  default     = "ozari-api"
}

variable "max_instances" {
  description = "Cloud Run maximum instance count."
  type        = number
  default     = 3
}

variable "min_instances" {
  description = "Cloud Run minimum instance count."
  type        = number
  default     = 0
}

variable "concurrency" {
  description = "Cloud Run max concurrent requests per instance."
  type        = number
  default     = 40
}

variable "timeout_seconds" {
  description = "Cloud Run request timeout in seconds. Set to 60 as a backstop above the app's own 30s request/response timeout, shrinking the window a slow request can hold an instance."
  type        = number
  default     = 60
}

variable "cpu" {
  description = "Cloud Run container CPU limit."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Cloud Run container memory limit."
  type        = string
  default     = "512Mi"
}

variable "build_trigger_name" {
  description = "Cloud Build trigger name."
  type        = string
  default     = "ozari-api-dev"
}

variable "build_trigger_branch_regex" {
  description = "Branch regex that fires the Cloud Build trigger."
  type        = string
  default     = "^dev$"
}

variable "github_repository_resource" {
  description = "Fully-qualified Cloud Build 2nd-gen GitHub repository resource."
  type        = string
  default     = "projects/ozari-500103/locations/northamerica-south1/connections/ozari-github/repositories/Romeo8Marroquin-ozari"
}
