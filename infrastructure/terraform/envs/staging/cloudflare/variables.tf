# --- Supplied by tf.ps1 -------------------------------------------------------

variable "state_bucket" {
  description = "From ../environment.json — where the bootstrap state (project number, region) is read from."
  type        = string
}

variable "cloudflare_account_id" {
  description = "From secrets/account.json."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "From secrets/account.json. The zone for partyrentalsgt.com."
  type        = string
}

# --- Shape (committed) --------------------------------------------------------

variable "cloud_run_service_name" {
  description = "Must equal the gcp root's service_name — it is part of the deterministic hostname."
  type        = string
  default     = "ozari-api"
}

variable "github_owner" {
  type    = string
  default = "Romeo8Marroquin"
}

variable "github_repo_name" {
  type    = string
  default = "ozari"
}

variable "pages_build_env" {
  description = "Build-image variables for Pages (no secrets — everything in a Vite build is public)."
  type        = map(string)
  default = {
    NODE_VERSION = "22"
  }
}
