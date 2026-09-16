# ---------------------------------------------------------------------------
# DNS.
#
# Both records are PROXIED (orange cloud) and both have to be:
#   · the API record, because a Worker route only runs on proxied traffic — grey-clouded, the
#     request goes straight to run.app, the Host rewrite never happens, and Google answers 404;
#   · the frontend record, because that is how Pages serves a custom domain over Cloudflare's edge.
#
# TTL is forced to 1 (automatic) on proxied records — Cloudflare rejects anything else, and the
# error names the field rather than the cause.
# ---------------------------------------------------------------------------

resource "cloudflare_dns_record" "api" {
  zone_id = var.zone_id
  name    = var.api_hostname
  type    = "CNAME"
  content = var.cloud_run_hostname
  ttl     = 1
  proxied = true
  comment = "Ozari ${var.environment} API — proxied so the Worker route can rewrite Host to Cloud Run. Terraform-managed."
}

resource "cloudflare_dns_record" "app" {
  zone_id = var.zone_id
  name    = var.app_hostname
  type    = "CNAME"
  content = "${var.pages_project_name}.pages.dev"
  ttl     = 1
  proxied = true
  comment = "Ozari ${var.environment} frontend — Cloudflare Pages custom domain. Terraform-managed."
}

# Everything else this environment is responsible for: Resend's DKIM/SPF/MX, verification TXTs.
# Records belonging to other projects on this shared zone are deliberately absent.
resource "cloudflare_dns_record" "extra" {
  for_each = var.extra_dns_records

  zone_id  = var.zone_id
  name     = each.value.name
  type     = each.value.type
  content  = each.value.content
  ttl      = each.value.ttl
  priority = each.value.priority
  proxied  = each.value.proxied
  comment  = coalesce(each.value.comment, "Terraform-managed (${var.environment}).")
}
