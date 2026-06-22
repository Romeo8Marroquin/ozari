#!/usr/bin/env bash
# Idempotent creation of the Terraform remote-state bucket.
# The bucket already exists in this project; this script is safe to re-run and will
# simply skip creation and ensure versioning is on.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-ozari-500103}"
REGION="${REGION:-northamerica-south1}"
BUCKET="gs://ozari-500103-tfstate"

echo "Project : ${PROJECT_ID}"
echo "Region  : ${REGION}"
echo "Bucket  : ${BUCKET}"

if gcloud storage buckets describe "${BUCKET}" >/dev/null 2>&1; then
  echo "Bucket ${BUCKET} already exists. Skipping creation."
else
  echo "Creating bucket ${BUCKET}..."
  gcloud storage buckets create "${BUCKET}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi

echo "Ensuring object versioning is enabled (protects state history)..."
gcloud storage buckets update "${BUCKET}" --versioning

echo "Done."
