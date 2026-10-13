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
  secrets = {
    # The GitHub token the Cloud Build 2nd-gen connection authenticates with.
    #
    # It is in this registry rather than created by hand because the connection resource references
    # `versions/latest` of it: if the secret does not exist with a value at the moment the connection
    # is created, the apply fails — which is exactly the kind of ordering that should be an edge in
    # the graph, not a step in a runbook. It is read by Cloud Build's Google-managed SERVICE AGENT,
    # not by our own service accounts, so it grants nothing to the app.
    github_oauth_token = {
      secret_id    = var.github_oauth_token_secret_id
      env_var      = null
      run_access   = false
      build_access = false
    }

    database_url = {
      secret_id    = "ozari-database-url"
      env_var      = "DATABASE_URL"
      run_access   = true
      build_access = false # the pipeline migrates with the MIGRATOR url; it never needs the app's
    }
    direct_database_url = {
      secret_id    = "ozari-direct-database-url"
      env_var      = null # pipeline-only: `prisma migrate deploy` runs as ozari_migrator (owns the schema).
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

  # Cloud Run resolves a `:latest` secret only when an instance STARTS. A rotated value therefore
  # reaches the API only through a new revision — without one, warm instances keep serving with the
  # old (possibly compromised) value until they happen to recycle. This number is the sum of the
  # rotation counters of every secret the service binds; counters only ever grow, so any rotation of
  # a runtime secret changes it, and cloud-run.tf carries it as a template label: the SAME apply that
  # pushes the new versions rolls a fresh revision (after them — the service depends_on the versions).
  # Pipeline-only secrets (GitHub token, migrator URL) are left out: rotating those needs no restart.
  runtime_secrets_generation = tostring(sum(concat([0], [
    for key in keys(local.runtime_secret_bindings) : lookup(var.secret_version_triggers, key, 1)
  ])))
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

  # Provider v8 makes this a REQUIRED string whenever `secret_data_wo` is set. An absent counter means
  # "1", the first version. A value that changes in the secrets file WITHOUT a counter bump is inert
  # — Terraform cannot see it — so a typo in the file can never silently rotate a live credential.
  # To rotate: new value + bumped counter (the scripts do both), then apply.
  secret_data_wo_version = tostring(lookup(var.secret_version_triggers, each.key, 1))

  deletion_policy = "DELETE"
}
