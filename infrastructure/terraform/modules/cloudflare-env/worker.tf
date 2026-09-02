# ---------------------------------------------------------------------------
# The edge proxy that puts a brand hostname in front of Cloud Run.
#
# Three resources, because Cloudflare split the old single `cloudflare_workers_script` (now
# deprecated) into a worker, an immutable version, and a deployment that points traffic at a
# version. Worker VERSIONS are immutable at the API level, so any change to the script replaces the
# version resource and the deployment moves 100% of traffic to the new one — which is the correct
# shape for a deploy, not an inconvenience.
# ---------------------------------------------------------------------------

locals {
  worker_script = templatefile("${path.module}/worker/api-proxy.js.tftpl", {
    cloud_run_hostname = var.cloud_run_hostname
    api_hostname       = var.api_hostname
  })
}

resource "cloudflare_worker" "api_proxy" {
  account_id = var.account_id
  name       = var.worker_name

  observability = {
    enabled = true
  }

  # The workers.dev URL is a SECOND public address for the API, bypassing the zone's WAF, rules and
  # any hostname-scoped protection. Off, so the only way in is the brand hostname.
  subdomain = {
    enabled = false
  }
}

resource "cloudflare_worker_version" "api_proxy" {
  account_id         = var.account_id
  worker_id          = cloudflare_worker.api_proxy.id
  compatibility_date = var.worker_compatibility_date
  main_module        = "index.js"

  modules = [{
    name         = "index.js"
    content_type = "application/javascript+module"
    # base64, not a heredoc: the script is templated from a real .js file that stays readable and
    # reviewable on its own, rather than being a string embedded in HCL.
    content_base64 = base64encode(local.worker_script)
  }]
}

resource "cloudflare_workers_deployment" "api_proxy" {
  account_id  = var.account_id
  script_name = cloudflare_worker.api_proxy.name
  strategy    = "percentage"

  versions = [{
    version_id = cloudflare_worker_version.api_proxy.id
    percentage = 100
  }]
}

# ⚠️ A ROUTE, not a Workers Custom Domain. A custom domain provisions its OWN DNS record and would
# collide with the proxied CNAME in dns.tf. The pattern must also name the API host exactly: the
# dashboard pre-fills `*.<zone>/*`, which would swallow the FRONTEND hostname and proxy the app
# itself into the API.
resource "cloudflare_workers_route" "api_proxy" {
  zone_id = var.zone_id
  pattern = "${var.api_hostname}/*"
  script  = cloudflare_worker.api_proxy.name

  depends_on = [cloudflare_workers_deployment.api_proxy]
}
