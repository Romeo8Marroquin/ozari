# ---------------------------------------------------------------------------
# Cloudflare Pages — the frontend.
#
# The value that matters here is VITE_API_URL. It is inlined into the bundle at BUILD time, so as a
# dashboard field it was invisible, unversioned and silently stale the moment the API moved. In code
# it is reviewable and diffable — but it still only takes effect on the NEXT build, which is why the
# runbook pairs every change to it with a redeploy.
# ---------------------------------------------------------------------------

resource "cloudflare_pages_project" "app" {
  account_id        = var.account_id
  name              = var.pages_project_name
  production_branch = var.pages_production_branch

  build_config = {
    build_command   = var.pages_build_command
    destination_dir = var.pages_build_output_dir
    root_dir        = var.pages_root_dir
  }

  deployment_configs = {
    production = {
      env_vars = {
        VITE_API_URL = {
          type  = "plain_text"
          value = var.vite_api_url
        }
      }
    }
    # Preview deployments get the same API origin on purpose. A preview on *.pages.dev talking to
    # the brand API is a THIRD-PARTY cookie situation and will not hold a session on Safari — that is
    # expected and acceptable for previews; what must never happen is a preview quietly pointing at
    # a different environment's data.
    preview = {
      env_vars = {
        VITE_API_URL = {
          type  = "plain_text"
          value = var.vite_api_url
        }
      }
    }
  }

  # Connecting Cloudflare to GitHub is a one-time OAuth authorization in the dashboard; Terraform can
  # reference it but cannot perform it. Declaring `source` before it exists fails the apply, so this
  # is opt-in rather than assumed.
  #
  # NOTE the syntax: in provider v5 `source`, `build_config` and `deployment_configs` are ATTRIBUTES
  # (`= { … }`), not blocks. v4 examples written with block syntax will not parse here, and the error
  # points at the brace rather than at the version mismatch.
  source = var.manage_pages_source ? {
    type = "github"
    config = {
      owner               = var.pages_github_owner
      repo_name           = var.pages_github_repo
      production_branch   = var.pages_production_branch
      deployments_enabled = true
      pr_comments_enabled = false
    }
  } : null
}

# A Pages custom domain does NOT create its DNS record; dns.tf owns that half.
resource "cloudflare_pages_domain" "app" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.app.name
  name         = var.app_hostname

  depends_on = [cloudflare_dns_record.app]
}
