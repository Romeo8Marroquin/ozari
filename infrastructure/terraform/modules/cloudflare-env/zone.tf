# ---------------------------------------------------------------------------
# Zone-wide behaviour.
#
# ⚠️ These settings belong to the DOMAIN, not to an environment. Exactly one environment may own
# them (`manage_zone_settings = true`) or two Terraform states will each believe they are
# authoritative and flip the value back and forth on alternate applies.
# ---------------------------------------------------------------------------

# Full (strict) — Cloudflare validates the origin certificate. Cloud Run presents a real public
# certificate, so there is no reason to accept less. Anything below "full" leaves the edge-to-origin
# hop unauthenticated; "flexible" would additionally serve the API over plaintext to Google and
# break the Secure cookie contract the whole custom-domain exercise exists to protect.
resource "cloudflare_zone_setting" "ssl" {
  count = var.manage_zone_settings ? 1 : 0

  zone_id    = var.zone_id
  setting_id = "ssl"
  value      = "strict"
}

resource "cloudflare_zone_setting" "always_use_https" {
  count = var.manage_zone_settings ? 1 : 0

  zone_id    = var.zone_id
  setting_id = "always_use_https"
  value      = "on"
}

# ---------------------------------------------------------------------------
# Keep the staging app out of search results.
#
# `public/robots.txt` ships `Allow: /` for the future marketing site, so without this a crawler can
# index the staging application under the brand domain. A response-header rule applies per hostname,
# which is what makes it possible to do this without forking the frontend build.
# ---------------------------------------------------------------------------

resource "cloudflare_ruleset" "noindex" {
  count = var.noindex_hostname == "" ? 0 : 1

  zone_id     = var.zone_id
  name        = "ozari-${var.environment}-noindex"
  description = "Serve X-Robots-Tag: noindex on ${var.noindex_hostname}"
  kind        = "zone"
  phase       = "http_response_headers_transform"

  rules = [{
    ref         = "noindex_${replace(var.environment, "-", "_")}"
    description = "Non-production hostname must not be indexed"
    expression  = "(http.host eq \"${var.noindex_hostname}\")"
    action      = "rewrite"
    enabled     = true

    action_parameters = {
      headers = {
        "X-Robots-Tag" = {
          operation = "set"
          value     = "noindex, nofollow"
        }
      }
    }
  }]
}
