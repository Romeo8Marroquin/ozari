# ---------------------------------------------------------------------------
# Artifact Registry — with the cleanup policy that keeps it free.
#
# Every build pushes :$COMMIT_SHA and :latest. Without a policy nothing is ever deleted: measured
# 2026-09-01 on staging, 27 images / 3.8 GB / oldest from June. Artifact Registry gives 0.5 GB free
# per billing account and charges $0.10/GB/month above it, so an unbounded registry is the single
# largest line on an otherwise ~$1/month bill — and it grows with every deploy, forever.
#
# ⚠️ Durations must be expressed in SECONDS. The provider rejects "7d"-style units on this field
# (hashicorp/terraform-provider-google#20796), and the failure is a confusing plan-time error.
#
# KEEP beats DELETE when an artifact matches both, so `keep-recent-releases` is what protects a
# rollback target from `delete-stale-tagged`.
# ---------------------------------------------------------------------------

resource "google_artifact_registry_repository" "images" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repository_id
  format        = "DOCKER"
  description   = "Docker images for the Ozari API (${var.environment})"

  labels = {
    environment = var.environment
    managed_by  = "terraform"
  }

  # Flip to true to see what a policy WOULD remove without removing it. Cleanup runs asynchronously
  # on Google's side, so a dry run is the only way to preview it.
  cleanup_policy_dry_run = var.artifact_cleanup_dry_run

  # Rollback targets. Three is a deliberate number: the current release, the one before it, and one
  # more for the case where the one before it is also the problem.
  cleanup_policies {
    id     = "keep-recent-releases"
    action = "KEEP"
    most_recent_versions {
      keep_count = var.artifact_keep_count
    }
  }

  # Build leftovers: an image whose tags have been moved off it by a newer build. Kept for a week so
  # a same-week rollback still has something to point at.
  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s" # 7 days
    }
  }

  # Tagged images older than the retention window. `keep-recent-releases` overrides this for the
  # newest N, so this only reaches genuinely superseded history.
  cleanup_policies {
    id     = "delete-stale-tagged"
    action = "DELETE"
    condition {
      tag_state  = "TAGGED"
      older_than = var.artifact_stale_tagged_seconds
    }
  }

  depends_on = [google_project_service.required]
}
