variable "cloudflare_account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone ID for partyrentalsgt.com (the same zone staging uses — one domain, two environments)."
  type        = string
}

variable "app_hostname" {
  description = "Production frontend hostname. The apex; Cloudflare's CNAME flattening is what allows a CNAME here at all."
  type        = string
  default     = "partyrentalsgt.com"
}

variable "pages_project_name" {
  description = "Cloudflare Pages project for production. A SEPARATE project from staging's — one project cannot serve two branches with two different VITE_API_URL values baked in."
  type        = string
  default     = "ozari-prod"
}

variable "r2_bucket_name" {
  description = "Production R2 bucket. Must equal the gcp root's r2_bucket_name."
  type        = string
  default     = "ozari-assets-prod"
}

variable "r2_custom_domain" {
  description = "Hostname serving public asset reads. Worth having in production: the URL is embedded in stored image references and printed documents."
  type        = string
  default     = "assets.partyrentalsgt.com"
}

variable "extra_dns_records" {
  description = "Records this environment owns (Resend DKIM/SPF/MX, verification TXTs). Only ever list what production is responsible for."
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
