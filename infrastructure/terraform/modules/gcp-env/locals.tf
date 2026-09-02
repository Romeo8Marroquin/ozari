# ---------------------------------------------------------------------------
# The runtime contract, computed ONCE.
#
# Cloud Run's service definition (terraform apply) and Cloud Build's `gcloud run deploy` (every
# push) both set the FULL env list — `--set-env-vars` and `--set-secrets` replace, they do not
# merge. Two hand-maintained copies of that list is how a deploy silently wipes a variable an apply
# had set, and the old docs carried a standing warning to "keep these in sync".
#
# They are the same list now. Terraform derives both strings here and passes them to the trigger as
# substitutions, so cloudbuild.yaml no longer enumerates anything — it just forwards what it was
# given. Adding a runtime variable is one line in this file (or one entry in secrets.tf).
#
# ⚠️ A value containing a comma would break `--set-env-vars` parsing. None do today; if one ever
# must, switch the deploy step to gcloud's alternate delimiter syntax (`--set-env-vars=^@^A=1@B=2`).
# ---------------------------------------------------------------------------

locals {
  image_url = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_repository_id}/${var.image_name}"

  runtime_env_vars = {
    NODE_ENV       = var.node_env
    LOG_LEVEL      = var.log_level
    APP_HOST       = var.app_host
    API_PUBLIC_URL = var.api_public_url
    R2_ENDPOINT    = var.r2_endpoint
    R2_BUCKET_NAME = var.r2_bucket_name
    R2_PUBLIC_URL  = var.r2_public_url
  }

  set_env_vars_arg = join(",", [for name, value in local.runtime_env_vars : "${name}=${value}"])

  set_secrets_arg = join(",", [
    for key, cfg in local.runtime_secret_bindings : "${cfg.env_var}=${cfg.secret_id}:latest"
  ])
}
