terraform {
  # 1.11 is the floor, not a preference: `secret_data_wo` (write-only arguments) is what allows
  # Terraform to own secret VALUES without persisting them to state. On an older Terraform this
  # module does not just warn — it fails to parse the argument.
  required_version = ">= 1.11.0"

  required_providers {
    google = {
      source = "hashicorp/google"
      # v8 made `secret_data_wo_version` a required STRING alongside `secret_data_wo` (secrets.tf).
      # Pinned to the minor series; a new major is a deliberate upgrade with its guide read first.
      version = "~> 8.6"
    }
    # Only for google_project_service_identity (iam.tf), which has no GA equivalent yet. Same
    # version line as `google`, always: the two providers share a codebase and are released together.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 8.6"
    }
  }
}
