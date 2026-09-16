# ---------------------------------------------------------------------------
# Secret Manager — containers, VERSIONS and access, in one place.
#
# THE REGISTRY. Adding a secret to Ozari is one entry in this map. It gets its container, its
# version, its IAM, its Cloud Run binding and its Cloud Build `--set-secrets` entry from here —
# there is no second list to remember (that list used to live in four files and drift).
#
#   env_var       the runtime env var it binds to on Cloud Run. null = not exposed to the service
#                 (direct_database_url is the migration pipeline's, and must never reach the app).
#   run_access    the Cloud Run runtime SA may read it.
#   build_access  the Cloud Build deploy SA may read it (migrations).
# ---------------------------------------------------------------------------

locals {
  # The GitHub personal access token the Cloud Build 2nd-gen connection authenticates with. Present
  # only when Terraform declares that connection.
  #
  # It is in this registry rather than created by hand because the connection resource references
  # `versions/latest` of it: if the secret does not exist with a value at the moment the connection
  # is created, the apply fails — which is exactly the kind of ordering that should be an edge in
  # the graph, not a step in a runbook. It is read by Cloud Build's Google-managed SERVICE AGENT,
  # not by our own service accounts, so it grants nothing to the app.
  github_token_secret = var.manage_github_connection ? {
    github_oauth_token = {
      secret_id    = var.github_oauth_token_secret_id
      env_var      = null
      run_access   = false
      build_access = false
    }
  } : {}

  secrets = merge(local.app_secrets, local.github_token_secret)

  app_secrets = {
    database_url = {
      secret_id    = "ozari-database-url"
      env_var      = "DATABASE_URL"
      run_access   = true
      build_access = true
    }
    direct_database_url = {
      secret_id    = "ozari-direct-database-url"
      env_var      = null # pipeline-only: `prisma migrate deploy` runs as the OWNER role.
      run_access   = false
      build_access = true
    }
    jwt_secret = {
      secret_id    = "ozari-jwt-secret"
      env_var      = "JWT_SECRET"
      run_access   = true
      build_access = false
    }
    jwt_refresh_secret = {
      secret_id    = "ozari-jwt-refresh-secret"
      env_var      = "JWT_REFRESH_SECRET"
      run_access   = true
      build_access = false
    }
    encryption_key = {
      secret_id    = "ozari-encryption-key"
      env_var      = "ENCRYPTION_KEY"
      run_access   = true
      build_access = false
    }
    api_key = {
      secret_id    = "ozari-api-key"
      env_var      = "API_KEY"
      run_access   = true
      build_access = false
    }
    email_key = {
      secret_id    = "ozari-email-key"
      env_var      = "EMAIL_KEY"
      run_access   = true
      build_access = false
    }
    r2_access_key = {
      secret_id    = "ozari-r2-access-key"
      env_var      = "R2_ACCESS_KEY"
      run_access   = true
      build_access = false
    }
    r2_secret_key = {
      secret_id    = "ozari-r2-secret-key"
      env_var      = "R2_SECRET_KEY"
      run_access   = true
      build_access = false
    }
    # The client ID is not strictly secret — it travels in the consent URL — but it is bound the same
    # way as its secret so the pair is loaded, rotated and revoked as ONE credential. Splitting it
    # across an env var and a secret is how half a rotated client ends up live.
    google_client_id = {
      secret_id    = "ozari-google-client-id"
      env_var      = "GOOGLE_CLIENT_ID"
      run_access   = true
      build_access = false
    }
    google_client_secret = {
      secret_id    = "ozari-google-client-secret"
      env_var      = "GOOGLE_CLIENT_SECRET"
      run_access   = true
      build_access = false
    }
  }

  # Derived views of the registry. Cloud Run (cloud-run.tf) and the Cloud Build substitutions
  # (cloud-build.tf) both read these, so the service and the deploy command cannot disagree.
  #
  # `runtime_secret_bindings` is ordered by the map's keys, which Terraform sorts lexicographically —
  # so the generated --set-secrets string is stable across plans and a diff never churns.
  runtime_secret_bindings = {
    for key, cfg in local.secrets : key => cfg if cfg.env_var != null
  }
  run_accessible_secrets   = { for key, cfg in local.secrets : key => cfg if cfg.run_access }
  build_accessible_secrets = { for key, cfg in local.secrets : key => cfg if cfg.build_access }
}

resource "google_secret_manager_secret" "this" {
  for_each = local.secrets

  project   = var.project_id
  secret_id = each.value.secret_id

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

# ---------------------------------------------------------------------------
# VERSIONS — the payloads.
#
# `secret_data_wo` is a Terraform 1.11 WRITE-ONLY argument: the value is sent to the API and then
# discarded. It is never persisted to state and never lands in a saved plan file, so the reason
# secrets used to be pushed by a separate gcloud script no longer applies. What Terraform keeps is
# `secret_data_wo_version`, an integer with no secret content, which is how it knows a rotation was
# requested — it cannot compare a value it deliberately does not remember.
#
# Consequence worth knowing: bumping the trigger REPLACES this resource, and the old version is
# destroyed with it. That is the intent (Secret Manager bills every enabled version, forever), but
# it means a rotation is not reversible from Google's side — to roll back, re-apply the previous
# value with a further bump.
# ---------------------------------------------------------------------------

resource "google_secret_manager_secret_version" "this" {
  for_each = local.secrets

  secret = google_secret_manager_secret.this[each.key].id

  # Indexed, not looked-up: a missing key must fail the plan loudly, naming the key, rather than
  # quietly creating an empty version that fails at container start with a much worse error.
  secret_data_wo = var.secret_values[each.key]

  # ⚠️ DEFAULTS TO null, AND THAT IS WHAT MAKES ADOPTION SAFE.
  #
  # On a fresh environment the trigger is irrelevant: the resource is being created, so the value is
  # sent regardless. On an EXISTING environment the version is imported instead, and an imported
  # version has no trigger in state — so a null default means config and state agree and the plan is
  # empty. Defaulting to `1` would show null → 1 on every imported secret and push a brand-new
  # version of all eleven.
  #
  # That is not merely wasteful (Secret Manager bills every enabled version, forever). It is the one
  # way this module could BREAK a working environment: if a value in secrets.auto.tfvars does not
  # match what is live — mistyped, or reconstructed from memory because nobody kept it — the apply
  # would silently rotate the secret to the wrong value, and staging would fail at the next cold
  # start with a credential error nothing points at. With a null trigger, a wrong value in the file
  # does nothing at all.
  #
  # To rotate: set the key to 1 (or bump it) in secret_version_triggers with the new value in place.
  secret_data_wo_version = lookup(var.secret_version_triggers, each.key, null)

  deletion_policy = "DELETE"
}
