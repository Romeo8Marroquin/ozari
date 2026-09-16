# Account/zone identifiers are not secrets, but they name your Cloudflare account, so they live in
# the gitignored terraform.tfvars rather than in a public repo. There are no defaults on purpose:
# an empty value here would make a plan target the wrong zone silently.

variable "cloudflare_account_id" {
  description = "Cloudflare account ID. Dashboard → any zone → Overview → API section."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone ID for partyrentalsgt.com."
  type        = string
}

variable "pages_project_name" {
  description = "Existing Cloudflare Pages project name (e.g. ozari-c28)."
  type        = string
}

variable "r2_bucket_name" {
  description = "R2 bucket for staging assets. Must equal the gcp root's r2_bucket_name — the API signs uploads for the bucket it was told about."
  type        = string
}

variable "manage_zone_settings" {
  description = "Whether THIS environment owns the zone-wide SSL settings. Exactly one environment may."
  type        = bool
  default     = true
}

variable "extra_dns_records" {
  description = "Resend DKIM/SPF/MX and any other records this environment owns. See terraform.tfvars.example."
  type = map(object({
    name     = string
    type     = string
    content  = string
    ttl      = optional(number, 1)
    priority = optional(number)
    proxied  = optional(bool, false)
    comment  = optional(string)
  }))
  default = {}
}
