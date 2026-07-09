# Ozari — Deployment Runbook

The end-to-end, dependency-ordered guide for deploying Ozari — **from zero to a running
environment** and for **ongoing releases**. It ties together the pieces that live in
`infrastructure/` (Terraform + scripts), `ozari-api/cloudbuild.yaml`, and the third-party
services (Neon, Cloudflare, Resend).

> **Scope.** Staging is **live** and adopted under Terraform (`infrastructure/terraform/envs/staging/`).
> **Production does not exist yet** — this document is the plan to create it perfectly when the time
> comes. Nothing here provisions prod on its own.

> **Public-repo safety.** This repo is public. **No secret values, connection strings, keys, or state
> ever go in git.** Every sensitive value is created out-of-band and stored in Secret Manager
> (backend) or the Cloudflare dashboard (frontend). Steps that must be done by hand for this reason
> are marked **🔒 manual**.

---

## 1. The moving parts (and who owns what)

| Component | Purpose | Managed by |
|---|---|---|
| **Neon (PostgreSQL)** | The database. Two URLs: **pooled** (runtime) + **direct** (migrations). | 🔒 manual (Neon console) + `db-roles.sql` |
| **GCP Secret Manager** | Holds all backend secret values. | Terraform owns the **containers + IAM**; values loaded 🔒 manually (`load-secrets-*`) |
| **GCP Artifact Registry** | Stores the API Docker image. | Terraform |
| **GCP Cloud Build** | CI/CD pipeline: verify → build → migrate → deploy. | Terraform owns the **trigger + substitutions**; steps in `ozari-api/cloudbuild.yaml` |
| **GCP Cloud Run** | Runs the API container. | Terraform owns **structure**; Cloud Build owns the **image tag** |
| **Cloudflare Pages** | Builds + hosts the frontend, serves the apex domain. | 🔒 manual (Cloudflare dashboard) |
| **Resend** | Transactional email (welcome, reset, security). Domain `partyrentalsgt.com` is verified. | 🔒 manual (Resend dashboard) — one API key per env |

**Environment switch:** `NODE_ENV` is the single switch. `staging` → audit logging on, `/api/docs`
served. `production` → `/api/docs` disabled (`isProductionEnvironment()` gate), audit logging on.

---

## 2. Secrets — the full list (never in git)

Backend reads these at runtime from Secret Manager (see `cloudbuild.yaml` `--set-secrets`), except
`DIRECT_DATABASE_URL`, which is **pipeline-only** (migrations):

| Secret container | Env var | Value | Used by |
|---|---|---|---|
| `ozari-database-url` | `DATABASE_URL` | Neon **pooled** URL, **`ozari_api`** role | API runtime |
| `ozari-direct-database-url` | `DIRECT_DATABASE_URL` | Neon **direct** URL, **owner** role | Migration step **only** |
| `ozari-jwt-secret` | `JWT_SECRET` | random 32+ byte secret | API runtime |
| `ozari-jwt-refresh-secret` | `JWT_REFRESH_SECRET` | random 32+ byte secret (distinct) | API runtime |
| `ozari-encryption-key` | `ENCRYPTION_KEY` | **exactly 32 bytes, hex** (AES-256-GCM) | API runtime |
| `ozari-api-key` | `API_KEY` | random shared secret for non-browser callers | API runtime |
| `ozari-email-key` | `EMAIL_KEY` | **Resend API key** (one per env) | API runtime |

Plain (non-secret) runtime env vars: `NODE_ENV`, `LOG_LEVEL`, `APP_HOST`. `PORT` is injected by Cloud
Run (8080). **Frontend:** `VITE_API_URL` (set 🔒 manually in Cloudflare Pages).

> ⚠️ `ENCRYPTION_KEY` **must never change** once data is encrypted with it — rotating it makes all
> existing encrypted PII unreadable. Generate it once per environment and keep it stable.

---

## 3. Database roles (owner vs API)

Two Postgres roles per database (see `infrastructure/scripts/db-roles.sql`):

- **owner** → `DIRECT_DATABASE_URL`. Full DDL. Runs `prisma migrate deploy` and manual admin. This is
  Neon's default owner role.
- **`ozari_api`** → `DATABASE_URL` (pooled). **DML only** — the running app can read/write rows but
  **cannot alter the schema**. Schema changes happen exclusively through migrations run as the owner.

Run `db-roles.sql` once per database **as the owner**, then put **only** the `ozari_api` pooled
connection string in `ozari-database-url`, and the owner direct string in `ozari-direct-database-url`.

---

## 3b. Object storage (Cloudflare R2)

Product/asset **images** live in a Cloudflare **R2** bucket. R2 is S3-compatible; the backend uses
`@aws-sdk/client-s3` (helper: `src/helpers/storage.ts`, policy: `appConfig.storage`). **Reads are
public** (no private data); **writes/deletes** use credentials, and the browser uploads **directly to
R2 via a short-lived presigned PUT URL** the API mints — image bytes never pass through Cloud Run, so
the 10 kB body cap stands. The integration code ships now; the product UI that uses it is Epic 1.

### The six env vars (and which are secret)

| Env var | Kind | Where it goes | Value |
|---|---|---|---|
| `R2_ENDPOINT` | plain | `terraform.tfvars` → `cloud-run.tf` + trigger sub | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_BUCKET_NAME` | plain | same | bucket name (e.g. `ozari-assets-staging`) |
| `R2_PUBLIC_URL` | plain | same | public read base URL (r2.dev or custom domain), **no trailing slash** |
| `R2_ACCESS_KEY` | **secret** | Secret Manager `ozari-r2-access-key` | S3 **Access Key ID** |
| `R2_SECRET_KEY` | **secret** | Secret Manager `ozari-r2-secret-key` | S3 **Secret Access Key** |
| ~~`R2_TOKEN`~~ | **not used** | — | the Cloudflare REST-API bearer; the **S3 SDK doesn't use it** — you can drop it (leaving it in `.env.example` is harmless, but don't create a secret for it) |

Rationale: the three plain values appear in browser-visible URLs anyway, but they're env-specific and
name your account/bucket, so they live in **gitignored `terraform.tfvars`** (never this public repo) and
reach the runtime via both `cloud-run.tf` **and** the Cloud Build trigger substitution (both required,
or a deploy and an apply overwrite each other — §6). The two **credentials** are Secret Manager secrets.
**The frontend needs NO R2 creds** — it uploads to the presigned URL and reads via `R2_PUBLIC_URL`.

### 🔒 Cloudflare dashboard (once per environment)
1. Create the bucket (e.g. `ozari-assets-staging`).
2. Enable **public read** — the bucket's `r2.dev` URL or a **custom domain** (recommended for prod,
   e.g. `https://assets.partyrentalsgt.com`) → this is `R2_PUBLIC_URL`.
3. Create an **R2 API token** scoped to that bucket (Object Read & Write) → copy the **Access Key ID**
   (`R2_ACCESS_KEY`) and **Secret Access Key** (`R2_SECRET_KEY`). The **Account ID** is in the endpoint.

### Ordered rollout on staging (the code + Terraform edits already exist in the repo)

> The secret **containers** must exist and be **filled with values BEFORE** Cloud Run binds them (a
> binding to `:latest` with no version fails to deploy). Hence the values-first, two-phase apply.

```
1. Put the 3 plain values into infrastructure/terraform/envs/staging/terraform.tfvars (gitignored):
      r2_endpoint / r2_bucket_name / r2_public_url        (see terraform.tfvars.example)

2. Create the secret CONTAINERS only (targeted apply — no binding yet, so no version needed). In
   PowerShell, QUOTE each -target or it gets split:
      terraform apply "-target=google_secret_manager_secret.ozari_r2_access_key" "-target=google_secret_manager_secret.ozari_r2_secret_key"
   (IAM + bindings are created by the full apply in step 5 — the service depends_on the IAM member.)

3. Load the secret VALUES via gcloud (never in Git):
      "<R2 Access Key ID>"     | gcloud secrets versions add ozari-r2-access-key --data-file=- --project ozari-500103
      "<R2 Secret Access Key>" | gcloud secrets versions add ozari-r2-secret-key --data-file=- --project ozari-500103

4. Full apply — now Cloud Run can bind the R2 env (plain + secret):
      terraform apply       (or scripts/apply-staging.ps1)

5. Redeploy the API so it picks up the new env (next push to the build branch, or a manual
   `gcloud run deploy` / re-run the trigger). cloudbuild.yaml is already updated to keep them set.
```

**Answering the specific questions:** yes — add the values then `terraform apply`, but in the
values-first order above. Only `R2_ACCESS_KEY`/`R2_SECRET_KEY` are secrets (the `gcloud secrets versions
add` in step 3); the three `R2_*` URL/name vars are **plain** and are defined in Cloud Build (via the
trigger substitution) + Terraform, not in Secret Manager. `R2_TOKEN` is **not needed** at all.

---

## 4. The URL chicken-and-egg (read before Part 1)

The backend needs the frontend origin; the frontend needs the backend URL:

- **`APP_HOST`** (backend) = the **frontend origin**. Used for CORS, the API-key origin check, and the
  links in emails. **Known in advance** — it's your apex domain (e.g. `https://partyrentalsgt.com`),
  so you set it *before* the first backend deploy. **No trailing slash.**
- **`VITE_API_URL`** (frontend) = the **backend URL**, which only exists *after* the backend deploys.

So the order is **backend first, then frontend**:

1. Choose the frontend apex domain → that value is `APP_HOST` (set it in the backend now).
2. Deploy the backend → it produces a URL (the generated `*.run.app`, or a custom `api.` subdomain via
   Cloud Run domain mapping — recommended for prod).
3. Put that backend URL into the frontend's `VITE_API_URL` (Cloudflare) → deploy the frontend → point
   the apex DNS at Cloudflare Pages.

> **Email logo dependency (soft):** `appConfig.email.logoUrl` points at `<frontend-origin>/email-logo.png`.
> Emails only render the logo once the **frontend is deployed** with that asset at the prod origin. Set
> `logoUrl` to the prod origin (code config in `src/config/app.ts`) as part of the prod cutover.

---

## 5. PART 1 — First production deploy, from zero (ordered)

> Do these **in order** — each step depends on the previous. Prereqs: `gcloud`, `terraform >= 1.5`,
> `pnpm`, `psql`, and dashboard access to Neon / Cloudflare / Resend.

### Step 0 — Decide the invariants
- Frontend apex domain (→ `APP_HOST`), e.g. `https://partyrentalsgt.com`.
- Backend URL strategy: generated `*.run.app` (quick) **or** `https://api.partyrentalsgt.com` (custom
  mapping, recommended).
- **Separate GCP project for prod** (hard isolation from staging — strongly recommended), a separate
  Terraform **state prefix** (`ozari/prod`), and separate secrets/trigger.

### Step 1 — 🔒 Neon database
1. Create the prod Neon project (or a prod branch, isolated from staging).
2. Note the **pooled** and **direct** connection strings.
3. Run the role setup as the owner: `psql "<direct-url>" -v db_name=<db> -f infrastructure/scripts/db-roles.sql`.
4. Build the two final connection strings: pooled-as-`ozari_api` (→ `ozari-database-url`) and
   direct-as-owner (→ `ozari-direct-database-url`).

### Step 2 — 🔒 Resend key
Domain `partyrentalsgt.com` is already verified (shared account). Create a **separate prod API key**
in Resend → that value is `ozari-email-key`. (Senders are code config on the verified domain; no DNS
work needed.)

### Step 3 — 🔒 Generate the remaining secret values
`ozari-jwt-secret`, `ozari-jwt-refresh-secret` (two distinct random 32+ byte secrets),
`ozari-encryption-key` (exactly 32 bytes hex), `ozari-api-key` (random). Keep them only in your local
gitignored `infrastructure/secrets/prod.env` (mirrors `staging.env`).

### Step 4 — GCP project + Terraform (infra)
1. Create the prod GCP project; enable billing.
2. Create the prod Terraform env: **copy `infrastructure/terraform/envs/staging/` → `envs/prod/`**,
   then change: `backend.tf` state prefix → `ozari/prod`; `variables.tf` defaults (project id, region,
   `_NODE_ENV=production`, `_APP_HOST=<apex>`, service name, etc.); drop `imports.tf` (prod is created
   fresh, not adopted). Everything else mirrors staging.
3. Create the state bucket (or reuse with the new prefix): `infrastructure/bootstrap/create-tfstate-bucket.*`.
4. `terraform init && terraform plan` (review) → `terraform apply` (🔒 after human approval). This
   creates: APIs, service accounts, Artifact Registry, **secret containers + IAM**, the Cloud Run
   service shell, and the Cloud Build trigger (pointed at **`main`**).

### Step 5 — 🔒 Load secret values
`infrastructure/scripts/load-secrets-*` (mirror for prod) reads your local `prod.env` and
`gcloud secrets versions add`s each of the 7 secrets. **No values touch git.** The app reads `:latest`.

### Step 6 — First backend build & deploy
Trigger the prod Cloud Build (first push to `main`, or run the trigger manually). The pipeline
(`cloudbuild.yaml`): **verify** (`pnpm install --frozen-lockfile` + `build` + `type-check`) → **build
+ push** image → **`prisma migrate deploy`** (in the image, using `DIRECT_DATABASE_URL` = owner) →
**`gcloud run deploy`** (with the env vars + secret bindings). `APP_HOST` is already set (Step 4).
→ **Record the resulting Cloud Run URL.** (Optionally map `api.partyrentalsgt.com` to it now.)

### Step 7 — Seed reference data (once)
Register/login depend on `user_roles` + `token_types` rows. Run the idempotent seed **once** against
the fresh prod DB: `pnpm db:seed` (with `DATABASE_URL` = the direct/owner URL for this one-off). Skip
on every later deploy — migrations don't seed, and it's safe to re-run but unnecessary.

### Step 8 — 🔒 Frontend (Cloudflare Pages)
1. Create the Pages project from this repo; build command `pnpm build`, output `dist`, root
   `ozari-app`, production branch `main`.
2. Set **`VITE_API_URL`** = the backend URL from Step 6.
3. Add the **custom apex domain** (must equal `APP_HOST`, no trailing slash) and point DNS at Pages.
4. Confirm `ozari-app/public/email-logo.png` is served at `<origin>/email-logo.png`, and set
   `appConfig.email.logoUrl` to the prod origin (code change + redeploy backend).

### Step 9 — Verify
- `GET /api/health/check` → healthy.
- `/api/docs` is **absent** in prod (correct — production-gated).
- Smoke test: register → login → forgot-password (email arrives from Resend) → reset → login.
- Confirm CORS: the browser app talks to the API; a random Origin is rejected.

---

## 6. Cloud Build substitutions & env ownership (the "param replacement")

`cloudbuild.yaml` is parameterised by **substitutions** (`_APP_HOST`, `_NODE_ENV`, `_IMAGE_URL`,
`_REGION`, `_RUN_SA`, `_SERVICE_NAME`, `_MAX_INSTANCES`, `_LOG_LEVEL`, and the `*_SECRET` names).
**Terraform owns the trigger's substitution values** (`cloud-build.tf` + `variables.tf`); the YAML only
provides fallback defaults. So to change `APP_HOST` (or any managed substitution) in a deployed env you
edit **Terraform**, not the Console:

1. Edit `envs/<env>/variables.tf` (value) and/or `cloud-build.tf` (mapping) → `plan` → `apply`.

**The one rule that bites:** both `terraform apply` and `gcloud run deploy --set-env-vars` do a **full
replacement** of the env vars. So the env-var list in `cloud-run.tf` and the `--set-env-vars` line in
`cloudbuild.yaml` **must stay identical**, or each deploy/apply will thrash the other. When you add a
runtime env var, update **both** (see the checklist in `infrastructure/README.md`).

Terraform deliberately **ignores the container image tag** — Cloud Build owns it (each build deploys
`:$COMMIT_SHA`).

---

## 7. PART 2 — Ongoing releases (redeploy on `main` merge)

Once Part 1 is done, releases are **automated**:

- **Backend:** merge to `main` → the prod Cloud Build trigger fires → verify → build → **migrate
  deploy** (applies only new migrations; a no-op when none are pending) → deploy. Zero manual steps.
- **Frontend:** merge to `main` → Cloudflare Pages auto-builds and deploys.
- **Secrets/infra changes** are the only manual paths: rotate a secret via `load-secrets-*` (+ redeploy
  to pick up `:latest`), or change infra via Terraform `plan`/`apply`.

Nothing else is required for a normal release. Structural changes (scaling, a new env var, IAM) go
through Terraform; app changes go through `main`.

---

## 8. Migrations strategy (dev ↔ prod)

**The one invariant:** `prisma/migrations/` is a **single, linear, append-only history**, and it is the
**same set** of migrations applied to every environment. Prisma records each applied migration (name +
checksum) in `_prisma_migrations`; two environments diverge the instant their migration folders differ.
**Never keep separate dev/prod migration directories** — that guarantees drift. You may rewrite history
**only on the tail that has not been deployed anywhere yet**; once a migration has run in prod, it is
**frozen forever**.

### 8a. First launch — squash to a clean baseline (one-time, recommended)
Right before prod exists (prod DB empty, nothing applied), collapse the accumulated dev feature
migrations into ONE baseline so prod starts clean and dev + prod share one history:

1. `schema.prisma` is the source of truth. Delete the folders inside `prisma/migrations/` (keep
   `migration_lock.toml`).
2. Generate one baseline (no shadow DB here, so use the engine diff — same approach as the existing
   migrations):
   ```sh
   mkdir prisma/migrations/00000000000000_init
   pnpm prisma migrate diff --from-empty \
     --to-schema-datamodel prisma/schema.prisma --script \
     > prisma/migrations/00000000000000_init/migration.sql
   ```
3. **Prod** (empty): the first pipeline run applies this baseline for real.
4. **Dev** (to match): `pnpm prisma migrate reset` (dev DB is disposable → drops, re-applies the
   baseline, runs seed). *Dev only — never `reset` prod.* (If you must preserve dev data, use the
   Prisma "baseline an existing DB" flow: `prisma migrate resolve --applied 00000000000000_init`.)
5. Commit. Now dev and prod are identical at `00000000000000_init`.

### 8b. Ongoing releases — two documented options
- **Recommended — append-only.** Each feature adds a new migration; the pipeline `migrate deploy`s it
  on merge. Never touch shipped migrations. History grows, and that is completely fine and the lowest
  risk. **Use this unless you have a specific reason not to.**
- **Optional — squash the *pending* tail per release.** To keep "one migration per release" in prod:
  before cutting a release, collapse the migrations **added since the last prod deploy** (the unshipped
  tail) into a single `release_vX_Y` migration (diff from the last-shipped schema → current), reset the
  **dev** DB to the rewritten history, then merge → deploy. **Rules:** only squash migrations that have
  **not** reached prod; never delete/rename one prod has applied; there is still exactly **one**
  migrations directory. Cost: a dev reset + discipline each release.

> ❌ **Do not** literally maintain two timelines ("prod migrations" vs "dev migrations") in the repo —
> Prisma will drift and `migrate deploy` will fight the schema. "One timeline; rewrite only the
> unshipped tail" gives you the tidy prod history you want without the drift.

---

## 9. Production deltas vs staging (quick diff)

| Thing | Staging | Production |
|---|---|---|
| GCP project | `ozari-500103` | **separate project** (recommended) |
| Terraform state prefix | `ozari/staging` | `ozari/prod` |
| Terraform env dir | `envs/staging/` (adopts existing) | `envs/prod/` (creates fresh; no `imports.tf`) |
| Cloud Build trigger branch | dev branch | `main` |
| `NODE_ENV` | `staging` | `production` (disables `/api/docs`) |
| `APP_HOST` | `https://ozari-c28.pages.dev` | apex domain, e.g. `https://partyrentalsgt.com` |
| Secrets | staging set | **separate** values (esp. a distinct Resend key + `ENCRYPTION_KEY`) |
| Frontend `VITE_API_URL` | staging Cloud Run URL | prod backend URL |
| Email `logoUrl` | staging pages.dev asset | prod frontend origin |

---

## 10. Rollback & emergencies

- **Backend rollback:** redeploy a previous image — `gcloud run deploy <svc> --image <IMAGE>:<goodSHA>`
  (every build is tagged `:$COMMIT_SHA` in Artifact Registry). **Note:** a rollback does **not** undo a
  migration — forward-only. Design migrations to be backward-compatible across one release if you want
  safe rollbacks.
- **Frontend rollback:** Cloudflare Pages → "Rollback to this deployment" on a prior build.
- **Console edits are emergency-only:** Terraform is the source of truth; a manual Console change is
  reverted on the next `apply`. If you must, fold the change back into Terraform immediately.
- **Never** run `terraform destroy` casually (it can delete the service, registry, secret containers,
  and SAs). There is no destroy helper on purpose.

---

## 11. First-launch checklist (copy-paste)

```
[ ] 0  Decide apex domain (APP_HOST), backend URL strategy, separate prod GCP project
[ ] 1  Neon prod DB created; db-roles.sql run as owner; pooled(ozari_api)+direct(owner) URLs ready
[ ] 2  Resend prod API key created
[ ] 2b R2 bucket created + public read (custom domain) + API token (access key id/secret) — see §3b
[ ] 3  JWT x2, ENCRYPTION_KEY (32B hex), API_KEY generated into local prod.env (gitignored)
[ ] 4  envs/prod/ Terraform (state prefix ozari/prod, NODE_ENV=production, APP_HOST=apex, no imports.tf)
[ ] 4  terraform init/plan/apply → containers, SAs, registry, Cloud Run shell, main-branch trigger
[ ] 5  load-secrets (prod) → all 7 secret versions added
[ ] 6  First build on main → verify/build/migrate/deploy → record backend URL (+ optional api. mapping)
[ ] 7  pnpm db:seed once against the fresh prod DB
[ ] 8  Cloudflare Pages: VITE_API_URL=backend URL, apex custom domain, email-logo.png served
[ ] 8  appConfig.email.logoUrl → prod origin (code + redeploy)
[ ] 9  Verify: /api/health/check, /api/docs absent, register→login→reset smoke test, CORS
```

---

**See also:** `infrastructure/README.md` (Terraform ownership rules, config-change checklist,
hardening TODOs), `infrastructure/terraform/envs/staging/README.md` (the staging env), `CLAUDE.md`
(architecture, auth, secrets facts), `ozari-api/README.md` / `ozari-app/README.md` (local dev).
