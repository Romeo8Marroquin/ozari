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
# ⚠️ ADOPT, DO NOT COLLIDE. The zone is live. Pointing Terraform at it without importing first makes
# every existing object look like something to CREATE, and the apply fails with "already exists".
# Run `infrastructure/scripts/cf-import.ps1 -Environment <env>` first: it inventories the account,
# writes import blocks for the objects THIS environment owns, and lists everything else as not ours
# (the `qa-ulew` landing page) without ever claiming it. After the import, a plan shows the real
# differences — and if the live config already matches, it shows nothing at all.
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
  description = "The run.app hostname the Worker rewrites Host to. Comes from the gcp-env module's output; never typed by hand."
  type        = string
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

variable "manage_pages_source" {
  description = <<-EOT
    Whether Terraform declares the Pages project's GitHub source connection.

    Default false, on purpose. Connecting Cloudflare to GitHub is an OAuth authorization performed
    once in the dashboard — Terraform can reference it but cannot create it, and declaring `source`
    before that authorization exists fails the apply. Leave false for an existing project; set true
    only after the account is authorized and you have read a plan.
  EOT
  type        = bool
  default     = false
}

variable "pages_github_owner" {
  description = "GitHub owner for the Pages source (used only when manage_pages_source = true)."
  type        = string
  default     = ""
}

variable "pages_github_repo" {
  description = "GitHub repository for the Pages source (used only when manage_pages_source = true)."
  type        = string
  default     = ""
}

# --- R2 ---------------------------------------------------------------------

variable "r2_bucket_name" {
  description = "R2 bucket for product/evidence images."
  type        = string
}

variable "r2_location_hint" {
  description = "R2 location hint (wnam, enam, weur, eeur, apac). Leave null to let Cloudflare choose."
  type        = string
  default     = null
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
  description = "Optional custom domain for public reads (e.g. assets.partyrentalsgt.com). Empty = use the bucket's r2.dev URL."
  type        = string
  default     = ""
}

# --- Zone behaviour ---------------------------------------------------------

variable "manage_zone_settings" {
  description = <<-EOT
    Whether this module sets zone-wide SSL settings. Zone settings are SHARED by every hostname on
    the domain, so exactly ONE environment may own them. Set true on the environment that owns the
    zone (production once it exists) and false on the other, or two applies will fight over one
    setting that both believe they own.
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
