# ---------------------------------------------------------------------------
# R2 — the asset bucket.
#
# CORS here is REQUIRED, not optional hardening: the browser PUTs gallery photos straight to the
# presigned S3 endpoint, which is a cross-origin request. Without a matching origin every upload
# fails at preflight while the rest of the app looks perfectly healthy — the most misleading failure
# in this stack, and previously a dashboard field nobody could diff.
#
# An earlier version of the plan recorded this as "may have no Terraform resource; if so it stays
# manual". It does have one (`cloudflare_r2_bucket_cors`), so it does not.
#
# What stays MANUAL and always will: the R2 API token (access key + secret key). A token created by
# Terraform would have its secret written to state — the one thing that must not happen — so it is
# minted in the dashboard and lands in the environment's gitignored secrets file.
# ---------------------------------------------------------------------------

resource "cloudflare_r2_bucket" "assets" {
  account_id    = var.account_id
  name          = var.r2_bucket_name
  location      = var.r2_location_hint
  storage_class = "Standard"
}

resource "cloudflare_r2_bucket_cors" "assets" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.assets.name

  rules = [
    {
      id = "browser-presigned-uploads"
      allowed = {
        # PUT only — the uploads. Reads have their own rule below.
        methods = ["PUT"]
        origins = var.r2_cors_allowed_origins
        headers = ["content-type"]
      }
      max_age_seconds = 3600
    },
    {
      # The printed documents FETCH each row's product photo (ozari-app `documentImages.ts`) to
      # re-encode it for react-pdf, which reads neither WebP nor AVIF — a CORS request, unlike the
      # catalog's plain <img> tags. Without this rule the PDFs still generate, without photos.
      #
      # Any origin, deliberately: every object here is already public (a plain GET with no Origin
      # header returns it), no credentials are involved, so a CORS allowlist on a read protects
      # nothing. And a wildcard is what keeps the EDGE CACHE honest: R2 echoes a matching origin,
      # so a response cached for one origin (localhost on staging) could be served to another and
      # fail there; `*` is the same answer for everyone.
      id = "public-reads"
      allowed = {
        methods = ["GET", "HEAD"]
        origins = ["*"]
      }
      max_age_seconds = 3600
    },
  ]
}

# Public reads come from a brand hostname, in every environment. It is cached at the edge, it is
# what the API writes into stored image URLs and printed documents, and Cloudflare creates its DNS
# record itself — so dns.tf must NOT declare one for it.
resource "cloudflare_r2_custom_domain" "assets" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.assets.name
  domain      = var.r2_custom_domain
  zone_id     = var.zone_id
  enabled     = true
  min_tls     = "1.2"
}
