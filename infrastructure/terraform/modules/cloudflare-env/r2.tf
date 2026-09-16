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

  rules = [{
    id = "browser-presigned-uploads"
    allowed = {
      # PUT only. Public reads are plain <img> tags, which are not CORS requests and need nothing
      # here; add GET only if something ever has to `fetch` an image from the app origin.
      methods = ["PUT"]
      origins = var.r2_cors_allowed_origins
      headers = ["content-type"]
    }
    max_age_seconds = 3600
  }]
}

# Optional: serve public reads from a brand hostname instead of the bucket's r2.dev URL. Worth it in
# production (the URL ends up embedded in every product image reference and in printed documents);
# unnecessary in staging.
resource "cloudflare_r2_custom_domain" "assets" {
  count = var.r2_custom_domain == "" ? 0 : 1

  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.assets.name
  domain      = var.r2_custom_domain
  zone_id     = var.zone_id
  enabled     = true
}
