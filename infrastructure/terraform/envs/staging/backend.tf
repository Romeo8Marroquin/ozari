# Remote state lives in a pre-existing GCS bucket. Do NOT put state in Git.
# The bucket (gs://ozari-500103-tfstate) already exists; see infrastructure/bootstrap/.
terraform {
  backend "gcs" {
    bucket = "ozari-500103-tfstate"
    prefix = "ozari/staging"
  }
}
