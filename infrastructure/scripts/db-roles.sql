-- ============================================================================
-- Ozari — database roles (least privilege)
-- ============================================================================
-- Two roles per database, matching the two connection strings the app already uses:
--
--   • OWNER role  → DIRECT_DATABASE_URL (secret `ozari-direct-database-url`)
--     Full DDL. Used ONLY by the migration pipeline (`prisma migrate deploy`) and
--     for manual admin/psql access. This is Neon's default owner role.
--
--   • ozari_api   → DATABASE_URL (secret `ozari-database-url`, the POOLED URL)
--     DML only (SELECT/INSERT/UPDATE/DELETE). NO CREATE/ALTER/DROP, no ownership.
--     Used by the API at runtime, so a compromised app can read/write rows but can
--     never change the schema. Schema changes only ever happen through migrations
--     run as the owner.
--
-- HOW TO RUN: connect to the target database AS THE OWNER (via the direct URL) and
-- run this whole file once per database (staging and, later, prod). It is idempotent.
--   psql "$DIRECT_DATABASE_URL" -v db_name=neondb -f db-roles.sql
-- Replace `neondb` with the actual database name if different.
--
-- The password below is a PLACEHOLDER. Set a strong password (Neon console or the
-- CREATE ROLE line), then store the resulting POOLED connection string for ozari_api
-- ONLY in Secret Manager as `ozari-database-url` — never here, never in git.
-- ============================================================================

-- 1) Create the runtime role (idempotent). Prefer setting the password in the Neon
--    console; if you set it here, replace the placeholder and do NOT commit the real one.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ozari_api') THEN
    CREATE ROLE ozari_api LOGIN PASSWORD 'CHANGE_ME_STORE_ONLY_IN_SECRET_MANAGER';
  END IF;
END
$$;

-- 2) Let it connect and use the schema (but not create objects in it).
GRANT CONNECT ON DATABASE :"db_name" TO ozari_api;
GRANT USAGE  ON SCHEMA public        TO ozari_api;

-- 3) DML on all EXISTING tables + sequences (no structural privileges).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO ozari_api;
GRANT USAGE, SELECT                  ON ALL SEQUENCES  IN SCHEMA public TO ozari_api;

-- 4) The same DML automatically on FUTURE tables/sequences the owner creates, so new
--    migrations "just work" without re-granting. Must be run AS THE OWNER (these default
--    privileges attach to objects created by the role that runs this statement).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ozari_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ozari_api;

-- Deliberately NOT granted: CREATE on the schema, table ownership, or any DDL. If you
-- ever add a migration that creates a NEW schema (not `public`), re-run steps 2–4 for it.
