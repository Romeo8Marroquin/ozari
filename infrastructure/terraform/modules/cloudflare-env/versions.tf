terraform {
  required_version = ">= 1.11.0"

  required_providers {
    cloudflare = {
      source = "cloudflare/cloudflare"
      # ⚠️ v5 is a rewrite, not an upgrade: resources were renamed (cloudflare_record →
      # cloudflare_dns_record, cloudflare_workers_script → the worker/worker_version/deployment
      # trio) AND many nested blocks became ATTRIBUTES (`x = { … }` instead of `x { … }`). Examples
      # found online usually target v4 and will not parse. Pin the major and read that major's docs.
      version = ">= 5.20.0, < 6.0.0"
    }
  }
}
