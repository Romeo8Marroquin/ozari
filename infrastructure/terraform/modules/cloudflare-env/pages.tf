# ---------------------------------------------------------------------------
# Cloudflare Pages — the frontend.
#
# The value that matters here is VITE_API_URL. It is inlined into the bundle at BUILD time, so as a
# dashboard field it was invisible, unversioned and silently stale the moment the API moved. In code
# it is reviewable and diffable — but it still only takes effect on the NEXT build, which is why
# `scripts/pages-build.ps1` exists.
#
# The project is created ALREADY CONNECTED to GitHub. That needs Cloudflare's GitHub app to be
# authorised on the account once (it is: the pre-rebuild staging project was Git-connected); after
# that, `source` is plain configuration. On an account that has never connected GitHub, the apply
# fails on this resource with an error about the repository — connect any project to GitHub once in
# the dashboard, delete it, and re-apply.
#
# NOTE the syntax: in provider v5 `source`, `build_config` and `deployment_configs` are ATTRIBUTES
# (`= { … }`), not blocks. v4 examples written with block syntax will not parse here.
# ---------------------------------------------------------------------------

locals {
  # Every build-time variable, in one map. VITE_API_URL is fixed by the module; anything the build
  # image needs (NODE_VERSION, PNPM_VERSION, …) comes from the environment root.
  pages_env_vars = {
    for name, value in merge(var.pages_build_env, { VITE_API_URL = var.vite_api_url }) :
    name => { type = "plain_text", value = value }
  }
}

resource "cloudflare_pages_project" "app" {
  account_id        = var.account_id
  name              = var.pages_project_name
  production_branch = var.pages_production_branch

  build_config = {
    build_command   = var.pages_build_command
    destination_dir = var.pages_build_output_dir
    root_dir        = var.pages_root_dir
    build_caching   = true
  }

  deployment_configs = {
    production = {
      env_vars = local.pages_env_vars
    }
    # Previews are switched off below, so this is only reached by a manual preview deploy. It gets
    # the same API origin on purpose: a preview must never quietly point at another environment.
    preview = {
      env_vars = local.pages_env_vars
    }
  }

  source = {
    type = "github"
    config = {
      owner             = var.pages_github_owner
      repo_name         = var.pages_github_repo
      production_branch = var.pages_production_branch

      production_deployments_enabled = true

      # ⚠️ OFF, and it matters for cost: staging and production are TWO projects on ONE repository.
      # With previews on, every push to `dev` would also build a preview in the production project
      # (and every push to `main` one in staging's), doubling the builds the free plan allows.
      preview_deployment_setting = "none"

      # Only frontend changes rebuild the frontend. An API-only commit costs no Pages build.
      path_includes = ["ozari-app/*"]

      pr_comments_enabled = false
    }
  }
}

# A Pages custom domain does NOT create its DNS record; dns.tf owns that half.
resource "cloudflare_pages_domain" "app" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.app.name
  name         = var.app_hostname

  depends_on = [cloudflare_dns_record.app]
}
