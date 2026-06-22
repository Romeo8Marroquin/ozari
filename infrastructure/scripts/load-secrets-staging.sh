#!/usr/bin/env bash
# Load secret VALUES into Secret Manager as new versions.
#
# This script contains NO secret values. It reads them from a local, GITIGNORED file:
#   infrastructure/secrets/staging.env
#
# Expected file format (KEY=VALUE, one per line; '#' comments allowed):
#   DATABASE_URL=postgres://...
#   DIRECT_DATABASE_URL=postgres://...
#   JWT_SECRET=...
#   JWT_REFRESH_SECRET=...
#   ENCRYPTION_KEY=...            # 32-byte hex
#   API_KEY=...
#
# Terraform manages the secret CONTAINERS; this script manages the VERSIONS/payloads.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-ozari-500103}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../secrets/staging.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Secret file not found: ${ENV_FILE}"
  echo "Create it (it is gitignored) using the KEY=VALUE format documented in this script."
  exit 1
fi

# Map local env keys -> Secret Manager secret names.
secret_for() {
  case "$1" in
    DATABASE_URL)        echo "ozari-database-url" ;;
    DIRECT_DATABASE_URL) echo "ozari-direct-database-url" ;;
    JWT_SECRET)          echo "ozari-jwt-secret" ;;
    JWT_REFRESH_SECRET)  echo "ozari-jwt-refresh-secret" ;;
    ENCRYPTION_KEY)      echo "ozari-encryption-key" ;;
    API_KEY)             echo "ozari-api-key" ;;
    *)                   echo "" ;;
  esac
}

while IFS= read -r line || [[ -n "${line}" ]]; do
  # strip leading/trailing whitespace
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [[ -z "${line}" || "${line:0:1}" == "#" ]] && continue

  key="${line%%=*}"
  value="${line#*=}"
  # trim spaces around key
  key="${key//[[:space:]]/}"

  secret="$(secret_for "${key}")"
  if [[ -z "${secret}" ]]; then
    echo "Skipping unknown key: ${key}"
    continue
  fi
  if [[ -z "${value}" ]]; then
    echo "Skipping ${key} (empty value)."
    continue
  fi

  echo "Adding new version to secret '${secret}' (from ${key})..."
  # Pipe value via stdin so it never appears in process args / shell history.
  printf '%s' "${value}" | gcloud secrets versions add "${secret}" --project="${PROJECT_ID}" --data-file=-
done < "${ENV_FILE}"

echo "Done. Verify with: gcloud secrets versions list <secret> --project=${PROJECT_ID}"
