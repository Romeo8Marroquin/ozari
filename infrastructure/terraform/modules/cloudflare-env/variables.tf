# ---------------------------------------------------------------------------
# cloudflare-env — the edge half of one Ozari environment.
#
# ⚠️⚠️ THE DOMAIN AND THE ZONE ARE NEVER MANAGED HERE, AND THAT IS STRUCTURAL.
#
# There is no `cloudflare_zone` resource and no registrar resource anywhere in this repository, and
# none may be added. `partyrentalsgt.com` is a purchased, renewable, account-level asset in the same
# category as the Google OAuth client: a human owns it, a human transfers it, a human renews it.
# Terraform manages the RECORDS INSIDE the zone and the services they point at — nothing above that
# line. A `terraform destroy` here removes records, a Worker, a Pages project and a bucket; it cannot
# remove, transfer, disable or fail to renew the domain, because it was never given the domain to
# hold. That is the guarantee, and it comes from the absence of a resource rather than from care.
#
# ⚠️ THE ZONE IS LIVE AND SHARED. Every object here is CREATED, never adopted, so a hostname that is
# still held by something else (a leftover DNS record, an old Pages custom domain, an old Worker
# route) fails the apply with "already exists". `infrastructure/scripts/cf-inventory.ps1` lists
# everything on the account as OURS / LEGACY (delete before the apply) / NOT OURS (the `qa-ulew`
# landing page — never touched).
# ---------------------------------------------------------------------------

variable "account_id" {
  description = "Cloudflare account ID (Workers, Pages and R2 are account-scoped)."
  type        = string
}

variable "zone_id" {
  description = "Cloudflare zone ID for the domain that serves this environment."
  type        = string
}

variable "environment" {
  description = "Logical environment name (staging | production)."
  type        = string
}

# --- Hostnames --------------------------------------------------------------

variable "api_hostname" {
  description = <<-EOT
    Full hostname the API answers on, e.g. api-staging.partyrentalsgt.com.

    ⚠️ ONE label below the apex. Universal SSL covers the apex plus a single subdomain level, so
    `api.staging.example.com` has no certificate and every request dies in the TLS handshake before
    it reaches the Worker. Use the hyphen form (`api-staging.`); covering the two-level form would
    mean Advanced Certificate Manager at roughly ten times this environment's total cost.
  EOT
  type        = string

  validation {
    condition     = length(split(".", var.api_hostname)) == 3
    error_message = "api_hostname must be exactly one label below the apex (e.g. api-staging.example.com) — Universal SSL covers no deeper."
  }
}

variable "app_hostname" {
  description = "Full hostname the frontend is served on. Must share the registrable domain with api_hostname, or the refresh cookie is third-party and iOS drops the session."
  type        = string
}

variable "cloud_run_hostname" {
  description = <<-EOT
    The run.app hostname the Worker rewrites Host to: Cloud Run's DETERMINISTIC form,
    <service>-<project_number>.<region>.run.app, computed by the environment root from the bootstrap
    state. Because it is known before the service exists, the edge can be applied first.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+\\.[a-z0-9-]+\\.run\\.app$", var.cloud_run_hostname))
    error_message = "cloud_run_hostname must look like <service>-<project_number>.<region>.run.app (no scheme)."
  }
}

# --- Worker -----------------------------------------------------------------

variable "worker_name" {
  description = "Name of the Worker that fronts Cloud Run."
  type        = string
}

variable "worker_compatibility_date" {
  description = "Workers runtime compatibility date. Pin it: bumping it changes runtime behaviour and should be a deliberate commit."
  type        = string
  default     = "2026-01-01"
}

# --- Pages ------------------------------------------------------------------

variable "pages_project_name" {
  description = "Cloudflare Pages project name."
  type        = string
}

variable "pages_production_branch" {
  description = "Branch Pages treats as production."
  type        = string
}

variable "vite_api_url" {
  description = <<-EOT
    VITE_API_URL for the Pages build.

    ⚠️ Vite INLINES this at build time. Terraform setting it is necessary and not sufficient — the
    frontend must be rebuilt afterwards or the deployed bundle still calls the old origin. This is
    exactly the footgun that made it worth moving into code: as a console field it was invisible and
    silently stale.
  EOT
  type        = string
}

variable "pages_build_command" {
  description = "Pages build command."
  type        = string
  default     = "pnpm build"
}

variable "pages_build_output_dir" {
  description = "Pages build output directory, relative to root_dir."
  type        = string
  default     = "dist"
}

variable "pages_root_dir" {
  description = "Subdirectory of the repo Pages builds from."
  type        = string
  default     = "ozari-app"
}

variable "pages_build_env" {
  description = <<-EOT
    Extra plain-text build variables for the Pages build image (e.g. NODE_VERSION). VITE_API_URL is
    set by the module and cannot be overridden here. Never put a secret in this map: everything in a
    Vite build ends up in the public bundle anyway.
  EOT
  type        = map(string)
  default     = {}

  validation {
    condition     = !contains(keys(var.pages_build_env), "VITE_API_URL")
    error_message = "Set VITE_API_URL through vite_api_url, not pages_build_env."
  }
}

variable "pages_github_owner" {
  description = "GitHub owner of the repository Pages builds from."
  type        = string
}

variable "pages_github_repo" {
  description = "GitHub repository Pages builds from."
  type        = string
}

# --- R2 ---------------------------------------------------------------------

variable "r2_bucket_name" {
  description = "R2 bucket for product/evidence images."
  type        = string
}

variable "r2_location_hint" {
  description = "R2 location hint (wnam, enam, weur, eeur, apac). `enam` = eastern North America, beside the API in us-east4. A hint, not a guarantee, and it cannot be changed after creation."
  type        = string
  default     = "enam"
}

variable "r2_cors_allowed_origins" {
  description = <<-EOT
    Origins allowed to PUT directly to R2 via a presigned URL.

    This is a BROWSER gate, not the upload authorization — that is the presigned signature (admin
    minted, 5-minute TTL, bound to key + content type + size). Still, scope it per environment:
    staging may list http://localhost:5173 because local dev uploads there; PRODUCTION MUST NOT —
    a compromised dev machine should not even be able to preflight against production assets.
  EOT
  type        = list(string)
}

variable "r2_custom_domain" {
  description = <<-EOT
    Hostname serving public reads (assets-stg. / assets.). Required, in every environment: the
    alternative, the bucket's r2.dev URL, is rate-limited, uncached, documented by Cloudflare as
    not-for-production, and can only be switched on in the dashboard. The frontend CSP allows
    *.partyrentalsgt.com for images, so any hostname on the zone works without a CSP change.
  EOT
  type        = string

  validation {
    condition     = length(split(".", var.r2_custom_domain)) == 3
    error_message = "r2_custom_domain must be one label below the apex (Universal SSL covers no deeper)."
  }
}

# --- Zone behaviour ---------------------------------------------------------

variable "manage_zone_settings" {
  description = <<-EOT
    Whether this module sets zone-wide SSL settings. Zone settings are SHARED by every hostname on
    the domain, so exactly ONE environment may own them: production (true), never staging (false),
    or two applies fight over one setting that both believe they own. Until production exists the
    zone simply keeps its current settings, which already serve staging today.
  EOT
  type        = bool
  default     = false
}

variable "noindex_hostname" {
  description = "Hostname to serve `X-Robots-Tag: noindex, nofollow` for. Set on staging so a crawler never indexes the staging app under the brand domain; leave empty on production."
  type        = string
  default     = ""
}

variable "extra_dns_records" {
  description = <<-EOT
    Additional DNS records this environment owns — Resend's DKIM/SPF/MX, domain verification TXTs,
    anything else. Keyed by a stable name so a later addition never renumbers the others.

    Only list records this environment is responsible for. Records belonging to the marketing site
    or another project on the same zone stay out of Terraform until somebody deliberately adopts them.
  EOT
  type = map(object({
    name     = string
    type     = string
    content  = string
    ttl      = optional(number, 1) # 1 = automatic
    priority = optional(number)
    proxied  = optional(bool, false)
    comment  = optional(string)
  }))
  default = {}
}
