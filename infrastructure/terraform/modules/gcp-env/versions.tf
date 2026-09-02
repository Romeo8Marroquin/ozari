terraform {
  # 1.11 is the floor, not a preference: `secret_data_wo` (write-only arguments) is what allows
  # Terraform to own secret VALUES without persisting them to state. On an older Terraform this
  # module does not just warn — it fails to parse the argument.
  required_version = ">= 1.11.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.20.0, < 7.0.0"
    }
  }
}
