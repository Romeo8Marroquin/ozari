-- ============================================================================
-- Ozari — prove the application role is actually least-privileged.
-- ============================================================================
-- Run as the OWNER (direct URL), after db-roles.sql:
--
--   psql "$DIRECT_DATABASE_URL" -v app_role=ozari_api -f db-verify.sql
--
-- This exists because "we created a restricted role" is a belief until something checks it. Every
-- query below prints PASS or FAIL; the last one raises an exception so a scripted run exits
-- non-zero rather than printing a failure nobody reads.
--
-- The interesting case it catches: a role created through the Neon Console, API, CLI or Terraform
-- provider is automatically a member of `neon_superuser` and can create and drop tables. Such a
-- role looks completely normal in the dashboard, and the application works perfectly with it —
-- right up until an injected statement does something a rented-tables app should never be able to
-- do. Check 2 is the one that finds it.
-- ============================================================================

\set ON_ERROR_STOP on

\echo '=== 1. Role attributes (expect: no superuser, no createdb, no createrole, no bypassrls) ==='
SELECT
  rolname,
  CASE WHEN NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolreplication
       THEN 'PASS' ELSE 'FAIL' END AS verdict,
  rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication, rolcanlogin
FROM pg_roles
WHERE rolname = :'app_role';

\echo ''
\echo '=== 2. Group memberships (expect: NONE — neon_superuser here means the role can do DDL) ==='
SELECT
  CASE WHEN count(*) = 0 THEN 'PASS — no inherited groups'
       ELSE 'FAIL — member of: ' || string_agg(g.rolname, ', ') END AS verdict
FROM pg_auth_members m
JOIN pg_roles g ON g.oid = m.roleid
JOIN pg_roles r ON r.oid = m.member
WHERE r.rolname = :'app_role';

\echo ''
\echo '=== 3. Schema privileges (expect: USAGE yes, CREATE no) ==='
SELECT
  CASE WHEN has_schema_privilege(:'app_role', 'public', 'USAGE')
        AND NOT has_schema_privilege(:'app_role', 'public', 'CREATE')
       THEN 'PASS' ELSE 'FAIL' END AS verdict,
  has_schema_privilege(:'app_role', 'public', 'USAGE')  AS can_use,
  has_schema_privilege(:'app_role', 'public', 'CREATE') AS can_create;

\echo ''
\echo '=== 4. Table privileges (expect: full DML on every table, ownership of none) ==='
SELECT
  CASE WHEN count(*) FILTER (
         WHERE NOT (has_table_privilege(:'app_role', c.oid, 'SELECT')
                AND has_table_privilege(:'app_role', c.oid, 'INSERT')
                AND has_table_privilege(:'app_role', c.oid, 'UPDATE')
                AND has_table_privilege(:'app_role', c.oid, 'DELETE'))
       ) = 0
       THEN 'PASS — DML on all ' || count(*) || ' tables'
       ELSE 'FAIL — missing DML on ' || count(*) FILTER (
         WHERE NOT (has_table_privilege(:'app_role', c.oid, 'SELECT')
                AND has_table_privilege(:'app_role', c.oid, 'INSERT')
                AND has_table_privilege(:'app_role', c.oid, 'UPDATE')
                AND has_table_privilege(:'app_role', c.oid, 'DELETE'))
       ) || ' table(s)' END AS verdict
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

SELECT
  CASE WHEN count(*) = 0 THEN 'PASS — owns no tables'
       ELSE 'FAIL — owns ' || count(*) || ' table(s); an owner can ALTER and DROP them' END AS verdict
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles r ON r.oid = c.relowner
WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = :'app_role';

\echo ''
\echo '=== 5. Default privileges (expect: an entry, or FUTURE migrations break the app) ==='
SELECT
  CASE WHEN count(*) > 0 THEN 'PASS — default privileges are set for future objects'
       ELSE 'FAIL — no ALTER DEFAULT PRIVILEGES; the next migration''s tables will be unreadable' END AS verdict
FROM pg_default_acl d
JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE n.nspname = 'public'
  AND array_to_string(d.defaclacl, ',') LIKE '%' || :'app_role' || '%';

\echo ''
\echo '=== 6. Sequences (expect: USAGE + SELECT, so INSERT into a serial-keyed table works) ==='
SELECT
  CASE WHEN count(*) FILTER (
         WHERE NOT (has_sequence_privilege(:'app_role', c.oid, 'USAGE')
                AND has_sequence_privilege(:'app_role', c.oid, 'SELECT'))
       ) = 0
       THEN 'PASS — usable on all ' || count(*) || ' sequences'
       ELSE 'FAIL — missing on some sequences; INSERTs will fail at runtime' END AS verdict
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S';

-- ---------------------------------------------------------------------------
-- The gate. Everything above prints; this one FAILS the run, so db-bootstrap can rely on the exit
-- code instead of on somebody reading six result sets.
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== GATE ==='

-- psql cannot expand :variables inside a dollar-quoted block, so the role name is handed to the
-- block through a session setting instead. This is the general workaround; it is also why
-- db-roles.sql uses \gexec rather than DO.
SELECT set_config('ozari.app_role', :'app_role', false);

DO $verify$
DECLARE
  problems text[] := '{}';
  r record;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = current_setting('ozari.app_role');

  IF r IS NULL THEN
    RAISE EXCEPTION 'Role % does not exist', current_setting('ozari.app_role');
  END IF;

  IF r.rolsuper      THEN problems := problems || 'is SUPERUSER'; END IF;
  IF r.rolcreatedb   THEN problems := problems || 'has CREATEDB'; END IF;
  IF r.rolcreaterole THEN problems := problems || 'has CREATEROLE'; END IF;
  IF r.rolbypassrls  THEN problems := problems || 'has BYPASSRLS'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles g ON g.oid = m.roleid
    WHERE m.member = r.oid
  ) THEN
    problems := problems || 'is a member of another role (neon_superuser grants DDL)';
  END IF;

  IF has_schema_privilege(r.rolname, 'public', 'CREATE') THEN
    problems := problems || 'has CREATE on schema public';
  END IF;

  IF array_length(problems, 1) > 0 THEN
    RAISE EXCEPTION 'Least-privilege check FAILED for %: %',
      r.rolname, array_to_string(problems, '; ');
  END IF;

  RAISE NOTICE 'PASS — % is least-privileged (DML only, no DDL, no group memberships)', r.rolname;
END
$verify$;
