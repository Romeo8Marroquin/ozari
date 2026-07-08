# Secret Manager CONTAINERS ONLY. Terraform manages the secret resources and their
# IAM (iam.tf) — it does NOT manage secret versions / payloads. Real values are added
# out-of-band via infrastructure/scripts/load-secrets-staging.* (gcloud), and are never
# committed to Git.
#
# Replication is assumed "automatic" (the gcloud default). If the live secrets use
# user-managed replication, `terraform plan` will surface a diff after import — review
# carefully before apply and adjust the replication block to match.
#
# All six secrets are adopted via import (see imports.tf).

resource "google_secret_manager_secret" "ozari_database_url" {
  project   = var.project_id
  secret_id = "ozari-database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "ozari_direct_database_url" {
  project   = var.project_id
  secret_id = "ozari-direct-database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "ozari_jwt_secret" {
  project   = var.project_id
  secret_id = "ozari-jwt-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "ozari_jwt_refresh_secret" {
  project   = var.project_id
  secret_id = "ozari-jwt-refresh-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "ozari_encryption_key" {
  project   = var.project_id
  secret_id = "ozari-encryption-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "ozari_api_key" {
  project   = var.project_id
  secret_id = "ozari-api-key"
  replication {
    auto {}
  }
}

# Resend API key (EMAIL_KEY) for transactional email. Container only — add the value out-of-band:
#   printf '%s' "re_..." | gcloud secrets versions add ozari-email-key --data-file=-
resource "google_secret_manager_secret" "ozari_email_key" {
  project   = var.project_id
  secret_id = "ozari-email-key"
  replication {
    auto {}
  }
}
