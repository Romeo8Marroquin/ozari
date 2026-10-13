// =============================================================================
// Ozari — create/rotate the database roles, then PROVE each holds exactly what it should.
//
// Called by neon.ps1; not meant to be run by hand. Inputs arrive as ENVIRONMENT variables, never as
// arguments (another process can read a command line):
//
//   OZ_OWNER_URL               the Neon OWNER's direct connection string (fetched fresh, never stored)
//   OZ_MIGRATOR_ROLE           default ozari_migrator
//   OZ_MIGRATOR_PASSWORD       the migrator's password (needed to connect AS it; always provided)
//   OZ_SET_MIGRATOR_PASSWORD   "1" → create the role / set that password
//   OZ_APP_ROLE                default ozari_api
//   OZ_APP_PASSWORD            set → create the role / set that password
//   OZ_VERIFY_ONLY             "1" → change nothing, only verify
//   OZ_TIGHTEN_URL             set (the MIGRATOR's URL) → only revoke the app's access to Prisma's
//                              _prisma_migrations table; used by db-seed.ps1 after the first deploy
//
// Runs on Node with the `pg` driver the API already depends on, so there is nothing to install.
// Prints a report; exits non-zero if ANY check fails, so the caller can trust the exit code.
//
// ---------------------------------------------------------------------------
// THREE LOGINS, THREE JOBS
//
//   neondb_owner    THE DBA. Neon's project owner (a member of neon_superuser). Creates the two
//                   roles below, and is what you use in pgAdmin. Its URL is NEVER stored: not in
//                   secrets/, not in Secret Manager, not in the pipeline. Get it from the Neon console
//                   when you need it.
//   ozari_migrator  THE SCHEMA. Owns every table, index, constraint, sequence, view, function and
//                   trigger in `public`, so it can CREATE / ALTER / DROP them — exactly what
//                   `prisma migrate deploy` (Cloud Build) and `db:seed` need. It cannot create
//                   databases or roles, and is no member of neon_superuser: a leaked pipeline secret
//                   reaches this one schema, not the server. → direct_database_url
//   ozari_api       THE APP. SELECT / INSERT / UPDATE / DELETE on every table, nextval on every
//                   sequence, EXECUTE on every function; triggers fire for it. No DDL, owns
//                   nothing. → database_url (POOLED)
//
// New objects are covered AUTOMATICALLY: the migrator's DEFAULT PRIVILEGES grant ozari_api its DML
// on every table/sequence/function a future migration creates. No re-run needed after a migration.
//
// WHY ROLES ARE SQL, NOT A NEON API CALL OR A TERRAFORM RESOURCE: a role created through the Neon
// Console, API, CLI or Terraform provider is automatically granted `neon_superuser` (CREATEDB,
// CREATEROLE, full DDL anywhere). Least privilege can only be made with SQL, by the owner.
//
// One limit worth knowing: CREATE EXTENSION needs neon_superuser on Neon, so a future migration that
// adds an extension must have that one statement run by the DBA first (none does today).
// =============================================================================

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiPackageJson = path.resolve(here, '..', '..', 'ozari-api', 'package.json');

let pg;
try {
  pg = createRequire(apiPackageJson)('pg');
} catch {
  console.error('Cannot load the `pg` driver from ozari-api. Run `pnpm install` inside ozari-api first.');
  process.exit(2);
}

const env = process.env;
const ownerUrl = env.OZ_OWNER_URL;
const migratorRole = env.OZ_MIGRATOR_ROLE || 'ozari_migrator';
const migratorPassword = env.OZ_MIGRATOR_PASSWORD || '';
const setMigratorPassword = env.OZ_SET_MIGRATOR_PASSWORD === '1';
const appRole = env.OZ_APP_ROLE || 'ozari_api';
const appPassword = env.OZ_APP_PASSWORD || '';
const verifyOnly = env.OZ_VERIFY_ONLY === '1';

const log = (line = '') => console.error(line);

// TIGHTEN mode (called by db-seed.ps1, which runs after the first deploy): connected AS the migrator,
// take back the app's access to Prisma's bookkeeping table. The migrator's default privileges grant
// it when `migrate deploy` first creates that table, and neon.ps1 runs before it exists.
if (env.OZ_TIGHTEN_URL) {
  const c = new pg.Client({ connectionString: env.OZ_TIGHTEN_URL });
  try {
    await c.connect();
    const { rows } = await c.query(`SELECT to_regclass('public._prisma_migrations') AS t`);
    if (rows[0].t) {
      await c.query(`REVOKE ALL ON public._prisma_migrations FROM ${c.escapeIdentifier(appRole)}`);
      log(`${appRole}: no access to _prisma_migrations.`);
    }
  } catch (error) {
    log(`Database error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await c.end().catch(() => {});
  }
  process.exit();
}

if (!ownerUrl) {
  log('OZ_OWNER_URL is not set.');
  process.exit(2);
}
for (const name of [migratorRole, appRole]) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    log(`Refusing role name "${name}": lowercase letters, digits and underscores only.`);
    process.exit(2);
  }
}
if (!verifyOnly && !migratorPassword) {
  log('OZ_MIGRATOR_PASSWORD is not set (the grants on its objects are made while connected AS it).');
  process.exit(2);
}

const owner = new pg.Client({ connectionString: ownerUrl });

async function one(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows[0];
}

/** The owner URL with another role's credentials: same host, same database, same TLS settings. */
function urlFor(role, password) {
  const u = new URL(ownerUrl);
  u.username = encodeURIComponent(role);
  u.password = encodeURIComponent(password);
  return u.toString();
}

async function ensureRole(name, password, setPassword) {
  const role = owner.escapeIdentifier(name);
  const exists = await one(owner, 'SELECT 1 AS found FROM pg_roles WHERE rolname = $1', [name]);
  if (!exists) {
    await owner.query(`CREATE ROLE ${role} NOLOGIN`);
    log(`Created role ${name}.`);
  }
  // CREATE ROLE's defaults are already NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOBYPASSRLS. Only
  // what a non-superuser owner may set is asserted here; the rest is CHECKED in verify(). DDL takes no
  // bind parameters, hence escapeLiteral for the password.
  const pw = setPassword ? ` PASSWORD ${owner.escapeLiteral(password)}` : '';
  await owner.query(`ALTER ROLE ${role} LOGIN NOCREATEDB NOCREATEROLE${pw}`);
  if (setPassword) log(`Role ${name}: ${exists ? 'password rotated' : 'password set'}.`);
}

async function configure() {
  const { current_database: db, current_user: me } = await one(owner, 'SELECT current_database(), current_user');
  const database = owner.escapeIdentifier(db);
  const migrator = owner.escapeIdentifier(migratorRole);
  const app = owner.escapeIdentifier(appRole);

  // --- As the OWNER: the roles, and where each may connect and build ---------------------------
  await ensureRole(migratorRole, migratorPassword, setMigratorPassword);
  await ensureRole(appRole, appPassword, appPassword !== '');

  // The DBA may `SET ROLE ozari_migrator` for an emergency fix, and can hand over objects it created by
  // mistake (below) — without INHERITING the migrator's rights in everyday use.
  try {
    await owner.query(`GRANT ${migrator} TO ${owner.escapeIdentifier(me)} WITH INHERIT FALSE, SET TRUE`);
  } catch (error) {
    // Not fatal: without it only the hand-over of stray objects below needs it, and fails loudly then.
    log(`NOTE  could not let ${me} SET ROLE ${migratorRole} (${error.message}).`);
  }

  // Postgres lets EVERY role connect (and make temp tables) by default. Only these two (and the DBA,
  // the database's owner) may.
  await owner.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await owner.query(`GRANT CONNECT ON DATABASE ${database} TO ${migrator}, ${app}`);
  await owner.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${migrator}`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${app}`);
  // PUBLIC lost CREATE on `public` in Postgres 15; revoking again keeps the intent true on a database
  // restored from an older dump.
  await owner.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await owner.query(`REVOKE CREATE ON SCHEMA public FROM ${app}`);

  // Anything in `public` the OWNER created (a table made in pgAdmin, a restore) goes to the migrator,
  // or a later migration could not ALTER it and the app could not read it. Sequences that belong to a
  // column move with their table.
  const strays = await owner.query(
    `SELECT c.relkind, quote_ident(c.relname) AS ident
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
        AND NOT (c.relkind = 'S' AND EXISTS (
              SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')))`,
  );
  const kinds = { r: 'TABLE', p: 'TABLE', v: 'VIEW', m: 'MATERIALIZED VIEW', S: 'SEQUENCE' };
  for (const s of strays.rows) {
    await owner.query(`ALTER ${kinds[s.relkind]} public.${s.ident} OWNER TO ${migrator}`);
    log(`Ownership of ${s.ident} handed to ${migratorRole}.`);
  }
  const strayFunctions = await owner.query(
    `SELECT p.oid::regprocedure::text AS sig
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`,
  );
  for (const f of strayFunctions.rows) {
    await owner.query(`ALTER ROUTINE ${f.sig} OWNER TO ${migrator}`);
    log(`Ownership of ${f.sig} handed to ${migratorRole}.`);
  }

  // --- As the MIGRATOR: the app's rights on the migrator's objects, today AND tomorrow ----------------
  // Done while connected AS the migrator, so the default privileges are its own: they fire for every
  // object a future `prisma migrate deploy` creates, with no membership tricks and no re-run.
  const asMigrator = new pg.Client({ connectionString: urlFor(migratorRole, migratorPassword) });
  await asMigrator.connect();
  try {
    await asMigrator.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}`);
    await asMigrator.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}`);
    await asMigrator.query(`GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO ${app}`);
    await asMigrator.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`,
    );
    await asMigrator.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${app}`);
    await asMigrator.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON ROUTINES TO ${app}`);
    // Prisma's own bookkeeping is the migrator's business. (A run before the first migration cannot
    // revoke a table that does not exist yet; the default privilege then grants it when the first
    // deploy creates it, and db-seed.ps1 — which runs right after that deploy — takes it back.)
    const prismaTable = await one(asMigrator, `SELECT to_regclass('public._prisma_migrations') AS t`);
    if (prismaTable.t) await asMigrator.query(`REVOKE ALL ON public._prisma_migrations FROM ${app}`);
  } finally {
    await asMigrator.end().catch(() => {});
  }
  // Sequences get USAGE+SELECT, NOT UPDATE: nextval() is all an INSERT needs, setval() rewrites a
  // counter. That is why `db:seed` (which resets sequences) runs as the MIGRATOR.
  log(`Grants applied: ${migratorRole} owns the schema's objects; ${appRole} has DML on them, now and later.`);
}

async function verify() {
  const problems = [];
  const check = (ok, label, detail) => {
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) problems.push(label);
  };
  const note = (text) => log(`  NOTE  ${text}`);

  const attrs = (name) =>
    one(
      owner,
      `SELECT oid, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication, rolcanlogin
         FROM pg_roles WHERE rolname = $1`,
      [name],
    );
  // THE check that matters on Neon: membership in neon_superuser is how DDL sneaks in, and a role in
  // that state looks completely normal and works perfectly.
  const groupsOf = async (name) =>
    (
      await one(
        owner,
        `SELECT coalesce(string_agg(g.rolname, ', '), '') AS names
           FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
          WHERE u.rolname = $1`,
        [name],
      )
    ).names;
  const powerless = (r) => !r.rolsuper && !r.rolcreatedb && !r.rolcreaterole && !r.rolbypassrls && !r.rolreplication;

  // --- migrator --------------------------------------------------------------------------------------
  log('');
  log(`${migratorRole} (schema owner — migrations and seed):`);
  const m = await attrs(migratorRole);
  if (!m) {
    check(false, `${migratorRole} exists`);
  } else {
    check(powerless(m), 'no superuser / createdb / createrole / bypassrls / replication');
    check(m.rolcanlogin, 'can log in');
    const g = await groupsOf(migratorRole);
    check(g === '', 'member of no other role (in particular not neon_superuser)', g ? `member of: ${g}` : '');
    const s = await one(
      owner,
      `SELECT has_schema_privilege($1, 'public', 'USAGE') AS u, has_schema_privilege($1, 'public', 'CREATE') AS c`,
      [migratorRole],
    );
    check(s.u && s.c, 'schema public: USAGE and CREATE');
    const foreign = await one(
      owner,
      `SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S') AND c.relowner <> $1)
            + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proowner <> $1) AS n`,
      [m.oid],
    );
    check(Number(foreign.n) === 0, 'owns every object in public', Number(foreign.n) ? `${foreign.n} owned by someone else` : '');
  }

  // --- app ---------------------------------------------------------------------------------------------
  log('');
  log(`${appRole} (the API — DML only):`);
  const a = await attrs(appRole);
  if (!a) {
    check(false, `${appRole} exists`);
    return problems;
  }
  check(powerless(a), 'no superuser / createdb / createrole / bypassrls / replication');
  check(a.rolcanlogin, 'can log in');
  const ag = await groupsOf(appRole);
  check(ag === '', 'member of no other role', ag ? `member of: ${ag}` : '');
  const as = await one(
    owner,
    `SELECT has_schema_privilege($1, 'public', 'USAGE') AS u, has_schema_privilege($1, 'public', 'CREATE') AS c`,
    [appRole],
  );
  check(as.u && !as.c, 'schema public: USAGE yes, CREATE no');

  const tables = await one(
    owner,
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE NOT (has_table_privilege($1, c.oid, 'SELECT') AND has_table_privilege($1, c.oid, 'INSERT')
                                    AND has_table_privilege($1, c.oid, 'UPDATE') AND has_table_privilege($1, c.oid, 'DELETE')))::int AS missing
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v') AND c.relname <> '_prisma_migrations'`,
    [appRole],
  );
  check(tables.missing === 0, 'full DML on every application table and view', `${tables.total} object(s)`);

  const owned = await one(
    owner,
    `SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relowner = $1)
          + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proowner = $1) AS n`,
    [a.oid],
  );
  check(Number(owned.n) === 0, 'owns nothing (an owner can ALTER and DROP)');

  const sequences = await one(
    owner,
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE NOT (has_sequence_privilege($1, c.oid, 'USAGE') AND has_sequence_privilege($1, c.oid, 'SELECT')))::int AS missing,
            count(*) FILTER (WHERE has_sequence_privilege($1, c.oid, 'UPDATE'))::int AS can_set
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S'`,
    [appRole],
  );
  check(sequences.missing === 0, 'USAGE+SELECT on every sequence', `${sequences.total} sequence(s)`);
  check(sequences.can_set === 0, 'cannot setval() any sequence');

  // Default privileges must be the MIGRATOR's: those are the ones that fire when a migration runs.
  if (m) {
    const defaults = await one(
      owner,
      `SELECT string_agg(DISTINCT d.defaclobjtype::text, '') AS types
         FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
        WHERE n.nspname = 'public' AND d.defaclrole = $1
          AND array_to_string(d.defaclacl, ',') LIKE '%' || $2 || '=%'`,
      [m.oid, appRole],
    );
    const t = defaults.types || '';
    check(t.includes('r') && t.includes('S') && t.includes('f'), "future tables, sequences and functions are granted automatically (the migrator's default privileges)");
  }

  const prismaTable = await one(
    owner,
    `SELECT CASE WHEN to_regclass('public._prisma_migrations') IS NULL THEN NULL
                 ELSE has_table_privilege($1, 'public._prisma_migrations', 'SELECT') END AS readable`,
    [appRole],
  );
  if (prismaTable.readable) note(`${appRole} can read _prisma_migrations; db-seed.ps1 (or any neon.ps1 run) revokes it.`);

  return problems;
}

try {
  await owner.connect();
  if (!verifyOnly) await configure();
  const problems = await verify();
  log('');
  if (problems.length > 0) {
    log(`FAILED: ${problems.length} check(s). The connection strings must NOT be used until this passes.`);
    process.exitCode = 1;
  } else {
    log(`PASS — ${migratorRole} owns the schema without server powers; ${appRole} is DML-only.`);
  }
} catch (error) {
  // pg error messages never contain a password, and no connection string is echoed.
  log(`Database error: ${error.message}`);
  process.exitCode = 1;
} finally {
  await owner.end().catch(() => {});
}
