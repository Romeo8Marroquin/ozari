#!/usr/bin/env bash
# =============================================================================
# Ozari — create (or rotate) the least-privileged application database role.
#
#   ./db-bootstrap.sh "postgresql://owner:pw@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require" [app_role]
#
# See db-bootstrap.ps1 for the full commentary. Same three steps: generate a password locally, run
# db-roles.sql as the owner, then run db-verify.sql — which exits non-zero if the role can do DDL.
#
# ⚠️ Prints a password. It is the only copy and is never written to disk here; paste it into the
# environment's gitignored secrets.auto.tfvars and then clear your scrollback.
# =============================================================================
set -euo pipefail

DIRECT_URL="${1:-}"
APP_ROLE="${2:-ozari_api}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$DIRECT_URL" ]]; then
  echo "usage: $0 <owner direct connection string> [app_role]" >&2
  exit 1
fi

# --- Parse the owner URL -----------------------------------------------------
proto_removed="${DIRECT_URL#*://}"
hostport_db="${proto_removed#*@}"
host_only="${hostport_db%%/*}"
host_only="${host_only%%:*}"
db_and_query="${hostport_db#*/}"
DB_NAME="${db_and_query%%\?*}"

if [[ -z "$DB_NAME" || -z "$host_only" ]]; then
  echo "Could not parse host/database out of the connection string." >&2
  exit 1
fi

# Neon's pooled endpoint is the direct host with '-pooler' on the FIRST label.
first_label="${host_only%%.*}"
rest="${host_only#*.}"
POOLER_HOST="${first_label}-pooler.${rest}"

# --- Generate the password ---------------------------------------------------
# Hex, not base64: every character is URL-safe. A '+' or '/' inside a connection string silently
# corrupts it and looks exactly like a wrong password.
APP_PASSWORD="$(openssl rand -hex 32)"

# --- Locate psql -------------------------------------------------------------
run_psql() {
  local file="$1"; shift
  if command -v psql >/dev/null 2>&1; then
    psql "$DIRECT_URL" -v ON_ERROR_STOP=1 "$@" -f "${SCRIPT_DIR}/${file}"
  elif command -v docker >/dev/null 2>&1; then
    PGURL="$DIRECT_URL" docker run --rm \
      -e PGURL \
      -v "${SCRIPT_DIR}:/sql:ro" \
      postgres:17-alpine \
      sh -c "psql \"\$PGURL\" -v ON_ERROR_STOP=1 $* -f /sql/${file}"
  else
    echo "Neither psql nor docker is available." >&2
    exit 1
  fi
}

echo
echo "Configuring role '${APP_ROLE}' on database '${DB_NAME}' ..."
run_psql db-roles.sql -v "app_role=${APP_ROLE}" -v "app_password=${APP_PASSWORD}" -v "db_name=${DB_NAME}"

echo
echo "Verifying privileges ..."
run_psql db-verify.sql -v "app_role=${APP_ROLE}"

POOLED="postgresql://${APP_ROLE}:${APP_PASSWORD}@${POOLER_HOST}/${DB_NAME}?sslmode=require"

cat <<EOF

============================================================
 Paste into the environment's secrets.auto.tfvars (GITIGNORED)
============================================================

  database_url        = "${POOLED}"
  direct_database_url = "<the owner URL you passed in>"

Then bump both keys in secret_version_triggers and run the apply wrapper.

Reminders:
  · database_url is POOLED (-pooler) and least-privileged — it is what the API runs as.
  · direct_database_url is the OWNER and is bound ONLY to the migration step, never to the
    running service.
  · Clear this terminal's scrollback: the password above is the only copy.

EOF
