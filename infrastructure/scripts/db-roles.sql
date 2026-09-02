-- ============================================================================
-- Ozari — database roles (least privilege). Idempotent; safe to re-run.
-- ============================================================================
-- Run it with scripts/db-bootstrap.ps1 (or .sh), which generates the password and passes the
-- variables. By hand:
--
--   psql "$DIRECT_DATABASE_URL" \
--     -v app_role=ozari_api -v app_password='<generated>' -v db_name=neondb \
--     -f db-roles.sql
--
-- ---------------------------------------------------------------------------
-- WHY THIS EXISTS, and why it cannot be a Terraform resource.
--
-- Neon has a Terraform provider and it can create roles — but any role created through the Neon
-- Console, API, CLI or that provider is automatically granted `neon_superuser`, which carries
-- CREATEDB, CREATEROLE and full DDL. That is the opposite of what this file is for. A genuinely
-- least-privileged application role can only be made with SQL, by the owner. So this stays a
-- script deliberately; moving it into Terraform would silently undo the whole point.
--
-- THE SPLIT, which mirrors the two connection strings the app already uses:
--
--   OWNER role  → DIRECT_DATABASE_URL (secret `ozari-direct-database-url`)
--                 Full DDL. Used ONLY by `prisma migrate deploy` in the build pipeline and by a
--                 human at a psql prompt. The running application never receives it — it is not
--                 bound to the Cloud Run service at all (modules/gcp-env/secrets.tf, env_var = null).
--
--   app role    → DATABASE_URL (secret `ozari-database-url`, the POOLED URL)
--                 SELECT / INSERT / UPDATE / DELETE and nothing else. No CREATE, no ALTER, no DROP,
--                 no ownership. A compromised API can read and write rows; it cannot drop a table,
--                 add a column, or create a role to escalate with.
--
-- ⚠️ psql does NOT expand :variables inside dollar-quoted blocks, so this file uses `\gexec`
-- (run a generated statement) rather than DO $$ … $$. A DO block here looks correct and silently
-- receives the literal text ":'app_role'".
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1) The role.
--
-- CREATE ROLE's defaults are already NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOBYPASSRLS /
-- NOREPLICATION, so the ALTER only asserts the two attributes a non-superuser owner is actually
-- permitted to set. The rest are CHECKED, not set, by db-verify.sql — on a managed Postgres the
-- owner is not a true superuser and `ALTER ROLE … NOSUPERUSER` would fail outright, taking the
-- whole script with it.
--
-- Re-running rotates the password. That is the rotation procedure: run this again, then put the new
-- URL in secrets.auto.tfvars and bump its entry in secret_version_triggers.
-- ---------------------------------------------------------------------------

SELECT format('CREATE ROLE %I NOLOGIN', :'app_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
\gexec

SELECT format(
  'ALTER ROLE %I LOGIN NOCREATEDB NOCREATEROLE PASSWORD %L',
  :'app_role', :'app_password'
)
\gexec

-- ---------------------------------------------------------------------------
-- 2) Connect and resolve names, but do not build.
--
-- USAGE lets the role see into the schema; CREATE is what lets a role make objects, and is withheld
-- from it and revoked from PUBLIC. On Postgres 15+ PUBLIC no longer holds CREATE on `public` by
-- default, but revoking costs nothing and keeps the intent true on a database restored from an
-- older server.
-- ---------------------------------------------------------------------------

GRANT CONNECT ON DATABASE :"db_name" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM :"app_role";

-- ---------------------------------------------------------------------------
-- 3) DML on everything that exists today.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- ---------------------------------------------------------------------------
-- 4) …and automatically on everything a future migration creates.
--
-- ⚠️ ALTER DEFAULT PRIVILEGES attaches to the role that RUNS it and applies only to objects that
-- role later creates. It is therefore correct exactly as long as migrations keep running as this
-- same owner. If the owner ever changes — a new Neon role, a branch restored under a different
-- owner — re-run this file AS THE NEW OWNER, or the next migration's tables will be invisible to
-- the app, which presents as a permission error on a table that plainly exists.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- Prisma's `_prisma_migrations` table is written by `migrate deploy` as the OWNER. The absence of a
-- grant is deliberate: the application has no reason to read, and no business writing, the record of
-- which migrations have run.

-- ⚠️ SEQUENCES ARE GRANTED `USAGE, SELECT` — NOT `UPDATE`, AND THAT IS THE POINT.
-- USAGE covers nextval(), which is all an INSERT needs. It does NOT cover setval(), which rewrites
-- the counter. So `pnpm db:seed` — which resets serial sequences after upserting reference data —
-- MUST be run with DATABASE_URL pointing at the OWNER (direct) URL, once, by hand. Run as the app
-- role it fails partway, having already inserted rows. Granting UPDATE here to make the seed
-- convenient would hand the running API the ability to rewrite every primary-key counter.

\echo ''
\echo 'Role configured. Run db-verify.sql before putting the connection string into secrets.'
