# ---------------------------------------------------------------------------
# gcp-env — every Google Cloud resource one Ozari environment needs.
#
# An environment is this module called with different inputs. Nothing in here is
# staging- or prod-specific: if you find yourself writing `environment == "prod" ? …`,
# add an input instead, so the two environments can never drift by accident.
# ---------------------------------------------------------------------------

variable "project_id" {
  description = "GCP project ID that holds this environment."
  type        = string
}

variable "project_number" {
  description = "GCP project number. Needed for the Cloud Build service-agent member string."
  type        = string
}

variable "region" {
  description = "Region for every regional resource (Cloud Run, Artifact Registry, the build trigger)."
  type        = string
}

variable "environment" {
  description = "Logical environment name (staging | production). Used for labels and descriptions only."
  type        = string
}

# --- Runtime identity -------------------------------------------------------

variable "service_name" {
  description = "Cloud Run service name."
  type        = string
}

variable "image_name" {
  description = "Container image name inside the Artifact Registry repository."
  type        = string
  default     = "ozari-api"
}

variable "artifact_repository_id" {
  description = "Artifact Registry Docker repository ID."
  type        = string
  default     = "ozari-images"
}

variable "artifact_keep_count" {
  description = "How many recent image versions the cleanup policy protects from deletion (rollback targets)."
  type        = number
  default     = 3
}

variable "artifact_stale_tagged_seconds" {
  description = "Age, in SECONDS, past which a tagged image is deleted unless it is one of the newest `artifact_keep_count`. The provider rejects unit suffixes on this field."
  type        = string
  default     = "2592000s" # 30 days
}

variable "artifact_cleanup_dry_run" {
  description = "Run the cleanup policies in DRY_RUN (log what would be deleted, delete nothing). Useful for exactly one apply on a registry that has never been pruned."
  type        = bool
  default     = false
}

# --- Application configuration (plain env vars) -----------------------------

variable "app_host" {
  description = <<-EOT
    The FRONTEND origin (APP_HOST), no trailing slash. CORS, the API-key browser-origin check and
    every email link compare against it. Must share a registrable domain with `api_public_url`, or
    the refresh cookie becomes third-party and Safari/iOS drops the session (DEPLOYMENT.md §3c).
  EOT
  type        = string

  validation {
    condition     = can(regex("^https?://[^/]+$", var.app_host))
    error_message = "app_host must be a scheme + host with NO trailing slash (the browser Origin header never has one)."
  }
}

variable "api_public_url" {
  description = <<-EOT
    The API's OWN public origin (API_PUBLIC_URL), no trailing slash. Required whenever a proxy sits
    in front of Cloud Run: the Cloudflare Worker rewrites Host to the run.app name, so the API cannot
    derive this from a request — and the calendar OAuth redirect URI plus the ICS feed URL an admin
    pastes into a phone are built from it.
  EOT
  type        = string

  validation {
    condition     = can(regex("^https?://[^/]+$", var.api_public_url))
    error_message = "api_public_url must be a scheme + host with NO trailing slash."
  }
}

variable "node_env" {
  description = "NODE_ENV — the single environment switch the app reads."
  type        = string

  validation {
    condition     = contains(["development", "staging", "production"], var.node_env)
    error_message = "node_env must be development, staging or production."
  }
}

variable "log_level" {
  description = "LOG_LEVEL runtime value."
  type        = string
  default     = "info"
}

variable "r2_endpoint" {
  description = "Cloudflare R2 S3 API endpoint (R2_ENDPOINT), https://<account-id>.r2.cloudflarestorage.com."
  type        = string
  default     = ""
}

variable "r2_bucket_name" {
  description = "R2 bucket holding public assets (R2_BUCKET_NAME)."
  type        = string
  default     = ""
}

variable "r2_public_url" {
  description = "Public read base URL for R2 assets (R2_PUBLIC_URL), no trailing slash."
  type        = string
  default     = ""
}

# --- Cloud Run shape --------------------------------------------------------

variable "min_instances" {
  description = "Cloud Run minimum instances. Keep at 0 — scale-to-zero is why idle costs nothing."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Cloud Run maximum instances. This is the spend cap."
  type        = number
  default     = 3
}

variable "concurrency" {
  description = "Max concurrent requests per instance."
  type        = number
  default     = 40
}

variable "timeout_seconds" {
  description = "Cloud Run request timeout. A backstop above the app's own 30s request/response timeout."
  type        = number
  default     = 60
}

variable "cpu" {
  description = "Container CPU limit."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Container memory limit."
  type        = string
  default     = "512Mi"
}

# --- Secrets ----------------------------------------------------------------

variable "secret_values" {
  description = <<-EOT
    The secret PAYLOADS, keyed by the logical names in `local.secrets` (secrets.tf).

    EPHEMERAL + WRITE-ONLY: these values are never written to Terraform state and never appear in a
    saved plan file. They reach Secret Manager through `secret_data_wo` and are then forgotten by
    Terraform, which is what makes it safe for Terraform to own the values at all (before Terraform
    1.11 it was not, and the old rule — "values never enter Terraform" — was correct for its time).

    Supplied from `secrets.auto.tfvars` in the environment directory, which is gitignored. Every key
    in `local.secrets` must be present or the apply fails naming the missing key.
  EOT
  type        = map(string)
  ephemeral   = true
  sensitive   = true
}

variable "secret_version_triggers" {
  description = <<-EOT
    Rotation counters, keyed like `secret_values`. A write-only argument leaves no trace in state, so
    Terraform cannot tell that a value changed — this number is how you tell it. Bump the entry to
    push a new version; leave it alone and an apply touches nothing.

    Bumping REPLACES the version resource, and the superseded version is DESTROYED (deletion_policy
    defaults to DELETE). That is deliberate: Secret Manager bills every enabled version forever, and
    hand-destroying old versions was previously a standing chore nobody remembers.
  EOT
  type        = map(number)
  default     = {}
}

# --- Cloud Build ------------------------------------------------------------

variable "build_trigger_name" {
  description = "Cloud Build trigger name."
  type        = string
}

variable "build_trigger_branch_regex" {
  description = "Branch regex that fires the trigger (e.g. ^dev$ for staging, ^main$ for production)."
  type        = string
}

variable "build_config_path" {
  description = "Path to the Cloud Build config inside the repository."
  type        = string
  default     = "ozari-api/cloudbuild.yaml"
}

variable "manage_github_connection" {
  description = <<-EOT
    Whether Terraform declares the Cloud Build 2nd-gen GitHub connection and repository link.

    false → reuse an existing connection by resource string (`github_repository_resource`). This is
            the right setting for an environment whose connection was created in the console and is
            working: importing a live connection is known to perma-diff on `app_installation_id`.
    true  → Terraform creates them. Requires `github_app_installation_id` and a Secret Manager secret
            holding a GitHub PAT (see `github_oauth_token_secret_id`). Installing the GitHub App and
            minting that PAT stay manual — there is no API for either.
  EOT
  type        = bool
  default     = false
}

variable "github_repository_resource" {
  description = "Existing Cloud Build 2nd-gen repository resource string. Used only when manage_github_connection = false."
  type        = string
  default     = ""
}

variable "github_connection_name" {
  description = "Name for the Cloud Build GitHub connection Terraform creates (manage_github_connection = true)."
  type        = string
  default     = "ozari-github"
}

variable "github_owner" {
  description = "GitHub account or organisation that owns the repository."
  type        = string
  default     = ""
}

variable "github_repo_name" {
  description = "GitHub repository name."
  type        = string
  default     = ""
}

variable "github_app_installation_id" {
  description = "Installation ID of the Cloud Build GitHub App on the repository. Read it from the GitHub App's settings URL after installing it."
  type        = string
  default     = ""
}

variable "github_oauth_token_secret_id" {
  description = <<-EOT
    Secret Manager secret ID holding a GitHub personal access token with REPO_ADMIN scope, used by
    the connection as its authorizer credential. Terraform binds `:latest`. The token itself is a
    manual step — GitHub has no API that mints one for you.
  EOT
  type        = string
  default     = ""
}

# --- Optional extras --------------------------------------------------------

variable "enable_cleanup_job" {
  description = <<-EOT
    Create a Cloud Run Job + Cloud Scheduler that runs `pnpm cleanup:sessions` nightly (expired
    sessions, spent password-reset tokens, lapsed auth-attempt windows).

    Off by default and that is an honest default, not neglect: nothing breaks if it never runs —
    every counter is re-evaluated by time, not by row count — so this is housekeeping, not
    correctness. Turn it on when the tables are big enough to notice. `purge:evidence` is
    deliberately NOT schedulable: it deletes photos, and a retention purge is a decision.
  EOT
  type        = bool
  default     = false
}

variable "cleanup_job_schedule" {
  description = "Cron schedule for the cleanup job (Cloud Scheduler syntax)."
  type        = string
  default     = "0 4 * * *"
}

variable "cleanup_job_timezone" {
  description = "Timezone for the cleanup schedule."
  type        = string
  default     = "America/Guatemala"
}

variable "revoke_default_compute_sa_editor" {
  description = <<-EOT
    Remove `roles/editor` from the project's default compute service account.

    ⚠️ AUTHORITATIVE. This uses google_project_iam_binding, which owns the FULL member list for
    roles/editor — applying it removes every other editor on the project too. That is the intent
    (nothing here should be a project editor; Cloud Run runs as ozari-run-sa and builds run as
    ozari-build-sa), but verify with `gcloud projects get-iam-policy` before flipping it on, and
    never flip it on and apply in the same run as anything else.
  EOT
  type        = bool
  default     = false
}
