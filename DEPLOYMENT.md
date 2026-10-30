# Ozari — Deployment Runbook

The operational guide for Ozari's deployed environments: **what each piece is, how a release
flows, how to change or rotate anything, and what to do when something breaks.** It ties together
`infrastructure/` (Terraform + scripts), `ozari-api/cloudbuild.yaml`, and the third-party services
(Neon, Cloudflare, Resend, Google Auth Platform).

> **Scope (2026-10-09).** Both environments are built by the same procedure with different inputs:
> **staging** (project `ozari-staging-gt`, deploys from `dev`) first, then **production** (project
> `ozari-prod-gt`, deploys from `main`). Region **`us-east4`**, database **Neon `aws-us-east-1`**.
>
> 👉 **Building an environment from zero — the ordered list of every step, manual or scripted — is
> [`REBUILD.md`](./REBUILD.md) §4.** It is not repeated here: two copies of one procedure is how a
> step gets re-broken. This file is what you need once an environment exists.

> **The other documents.** [`INFRASTRUCTURE-PLAN.md`](./INFRASTRUCTURE-PLAN.md) is the decision
> record — what is automated, what never can be, and why, plus the cost model.
> [`infrastructure/README.md`](./infrastructure/README.md) is how the Terraform and the scripts are
> laid out and operated. When a step below moves into code, it is deleted from here in the same
> commit.

> **Public-repo safety.** This repo is public. **No secret value, connection string, key or state
> ever goes in git.** Every secret and every account identifier lives in ONE gitignored directory on
> the operator's machine, `infrastructure/secrets/` (`account.json`, `staging.json`, `prod.json`),
> and reaches Terraform only as process environment variables set by `tf.ps1`. Steps that can only be
> done in a dashboard are marked **🔒 manual**.

---

## 1. The moving parts (and who owns what)

| Component | Purpose | Managed by |
|---|---|---|
| **GCP project + state bucket** | Where an environment lives; each project holds its OWN Terraform state. | Terraform — `envs/<env>/bootstrap` (via `tf.ps1 <env> bootstrap`) |
| **Neon (PostgreSQL)** | The database. Two stored URLs: **pooled** (runtime, DML-only `ozari_api`) + **direct** (migrations and seed, `ozari_migrator`, which owns the schema but has no server powers). The owner/DBA login is never stored (§3). | `scripts/neon.ps1` — creates the project through the Neon CLI, then both roles with SQL (`db-bootstrap.mjs`), and **proves** each holds only what its job needs. ⚠️ Deliberately NOT the Neon TF provider — a role it creates is auto-granted `neon_superuser`. |
| **GCP Secret Manager** | Holds all backend secret values. | **Terraform — containers, IAM AND versions.** Values reach it via write-only arguments and never enter state (Terraform ≥ 1.11). |
| **GCP Artifact Registry** | Stores the API Docker image. | Terraform, with **cleanup policies** that keep it inside the free tier |
| **GCP Cloud Build** | CI/CD: verify → build → migrate → deploy. | Terraform owns the **GitHub connection, trigger and every substitution**; steps in `ozari-api/cloudbuild.yaml` |
| **GCP Cloud Run** | Runs the API container (`ozari-api` in every project). | Terraform owns **structure**; Cloud Build owns the **image tag** |
| **Cloudflare Pages** | Builds + hosts the frontend. | Terraform — project **already connected to GitHub**, custom domain, `VITE_API_URL`. Previews off; only `ozari-app/*` changes build. |
| **Cloudflare Worker + DNS** | Puts the brand hostname in front of Cloud Run by rewriting `Host`. | Terraform |
| **Cloudflare R2** | Public object storage for images. S3-compatible. | Terraform (bucket, **CORS**, custom domain). 🔒 The API token is minted by hand — a TF-created one lands in state. |
| **Resend** | Transactional email. Domain `partyrentalsgt.com` is verified; its DNS records already exist and are left as they are. | 🔒 one API key per environment |
| **Google OAuth client** (Calendar) | Consent screen + client credentials. | 🔒 **manual, permanently** — no API exists (§3d) |

**Environment switch:** `NODE_ENV` is the single switch. `staging` → audit logging on, `/api/docs`
served. `production` → `/api/docs` disabled (`isProductionEnvironment()` gate), audit logging on.

### The command map

Every operation is one of these. All live in `infrastructure/scripts/` and are run from the repo
root in **Windows PowerShell**. The ones that read `infrastructure/secrets/` are run by the operator,
not by an assistant.

| Command | Does |
|---|---|
| `secret.ps1 <account\|staging\|prod> [<key>]` | Puts ONE value into the secrets files through a hidden prompt. Without a key: shows which keys are set (never values). Replacing an environment value bumps its rotation counter. |
| `new-secrets.ps1 <env> [-Rotate k1,k2]` | Generates `jwt_secret`, `jwt_refresh_secret`, `encryption_key`, `api_key` straight into the file. Prints names only. |
| `neon.ps1 <env> [-RotateAppPassword \| -RotateMigratorPassword \| -VerifyOnly]` | Neon project → migrator + app roles → verification → both URLs saved. |
| `db-seed.ps1 <env>` | `pnpm db:seed` against that environment, as the migrator; then revokes the app's access to `_prisma_migrations`. Once per fresh database. |
| `sync-products.ps1 <from> <to> [-Apply]` | MERGES the product catalog (details + photos) from one of `local\|staging\|prod` into another: products the target lacks are created, photos re-uploaded to the target's bucket; nothing in the target is modified. Dry run by default; `-Apply` to prod asks you to type `prod`. Both sides must run the current migrations. Rules: `EPIC-1-INVENTORY.md` §5. |
| `retire.ps1 <target> [-Execute]` | Delete an environment everywhere (Cloudflare → Neon → GCP project last). Dry run by default. |
| `tf.ps1 <env> <bootstrap\|cloudflare\|gcp> <plan\|apply\|output\|validate>` | Terraform. `plan` saves the plan; `apply` applies exactly that saved plan. |
| `cf-inventory.ps1 <env>` | Read-only: every Cloudflare object labelled OURS / CONFLICT / not ours. |
| `pages-build.ps1 <env>` | Starts a Pages build now (after a build-variable change, or a brand-new project). |

---

## 2. Secrets — the full list (never in git)

The values live in `infrastructure/secrets/<env>.json` (`secrets` section); `tf.ps1` hands them to
Terraform, which writes them into Secret Manager. The backend reads them at runtime through the
Cloud Run bindings, except `DIRECT_DATABASE_URL` (**pipeline-only**, migrations) and the GitHub token
(read only by Cloud Build's service agent):

| Key in `<env>.json` | Secret container | Env var | Value / source | Used by |
|---|---|---|---|---|
| `database_url` | `ozari-database-url` | `DATABASE_URL` | Neon **pooled** URL, **`ozari_api`** role — `neon.ps1` | API runtime |
| `direct_database_url` | `ozari-direct-database-url` | *(none)* | Neon **direct** URL, **`ozari_migrator`** (owns the schema, no server powers) — `neon.ps1` | Migration step **only** (and `db-seed.ps1` locally) |
| `jwt_secret` | `ozari-jwt-secret` | `JWT_SECRET` | 48 random bytes, hex — `new-secrets.ps1` | API runtime |
| `jwt_refresh_secret` | `ozari-jwt-refresh-secret` | `JWT_REFRESH_SECRET` | 48 random bytes, hex (distinct) — `new-secrets.ps1` | API runtime |
| `encryption_key` | `ozari-encryption-key` | `ENCRYPTION_KEY` | **exactly 32 bytes, hex** (AES-256-GCM) — `new-secrets.ps1` | API runtime |
| `api_key` | `ozari-api-key` | `API_KEY` | shared secret for non-browser callers — `new-secrets.ps1` | API runtime |
| `email_key` | `ozari-email-key` | `EMAIL_KEY` | 🔒 **Resend API key** (one per env) | API runtime |
| `r2_access_key` | `ozari-r2-access-key` | `R2_ACCESS_KEY` | 🔒 R2 S3 **Access Key ID** (§3b) | API runtime |
| `r2_secret_key` | `ozari-r2-secret-key` | `R2_SECRET_KEY` | 🔒 R2 S3 **Secret Access Key** (§3b) | API runtime |
| `google_client_id` | `ozari-google-client-id` | `GOOGLE_CLIENT_ID` | 🔒 OAuth **client ID** (§3d) | API runtime |
| `google_client_secret` | `ozari-google-client-secret` | `GOOGLE_CLIENT_SECRET` | 🔒 OAuth **client secret** (§3d) | API runtime |
| `github_oauth_token` | `ozari-github-oauth-token` | *(none)* | 🔒 GitHub **classic** PAT, scopes `repo` + `read:user` — Cloud Build rejects fine-grained tokens | Cloud Build's GitHub connection |

`tf.ps1` **refuses to plan the gcp stack while any of these is empty**: an empty Secret Manager
version is a container that dies at startup with an error that points at nothing.

The account-level values (shared by both environments) are in `infrastructure/secrets/account.json`:
`billing_account`, `github_app_installation_id`, `cloudflare_account_id`, `cloudflare_zone_id`,
`cloudflare_api_token`, `neon_org_id`, `neon_api_key`. The template with the Cloudflare token's exact scopes is
`infrastructure/templates/account.example.json`.

Plain (non-secret) runtime env vars, all set from `envs/<env>/gcp/variables.tf`: `NODE_ENV`,
`LOG_LEVEL`, `APP_HOST`, `API_PUBLIC_URL`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_ENDPOINT`
(derived from the Cloudflare account id) and `REGISTRATION_OPEN`. `PORT` is injected by Cloud Run
(8080).

> **`REGISTRATION_OPEN` — the per-environment sign-up switch.** Opening or closing sign-up is a
> business decision per environment, not a code change, so it lives in **no file and needs no
> commit: the live Cloud Run service is the record.** A new environment starts **open**; close it
> once there are enough users. Change it ONLY with
> `infrastructure/scripts/registration.ps1 <env> open|close` (a reviewed plan + apply touching just
> the service and the build trigger); `… status` reads the live value. Every other
> `tf.ps1 <env> gcp plan` reads the live value and passes it back unchanged, and the Terraform roots
> have no default for it, so no apply, deploy or rebuild flips it by accident. Existing accounts are
> never affected. The API **fails closed**: in a deployed environment only the exact string `true` opens
> `POST /auth/user` (anything else → `403` before validation); locally it stays open unless set to
> `false`. The app asks `GET /auth/registration` and shows the sign-up link and form only on a
> confirmed `true`.

> **`APP_HOST` and `API_PUBLIC_URL` are not the same host.** `APP_HOST` is the **frontend** origin
> (CORS, the API-key origin check, email links). `API_PUBLIC_URL` is the **API's own** origin, and it
> exists because the Cloudflare Worker in front of Cloud Run rewrites the `Host` header to the
> `run.app` name (§3c): the calendar's OAuth redirect URI and the ICS feed URL an admin pastes into
> their phone are built from it, and neither may name `run.app`. Empty ⇒ derived from the request,
> which is correct only for a deployment with nothing in front of it. No trailing slash (§3d).

**Frontend:** `VITE_API_URL`, declared in Terraform (`modules/cloudflare-env/pages.tf`).
**Not used:** `R2_TOKEN` (§3b).

> ⚠️ `ENCRYPTION_KEY` **must never change** once data is encrypted with it — rotating it makes all
> existing encrypted PII unreadable. `new-secrets.ps1` and `secret.ps1` both refuse to replace it
> without `-IUnderstandEncryptionKeyLoss`. Back `infrastructure/secrets/` up **off this machine**.

> ⚠️ **Every value must differ between staging and production.** A shared `jwt_secret` means a
> staging token authenticates against production; a shared `encryption_key` means a staging dump
> decrypts production PII.

---

## 3. Database roles (DBA vs migrator vs API)

Three logins per database. `neon.ps1` creates the last two with SQL and saves their URLs.

| Login | Who uses it | Can | Cannot | Where its URL lives |
|---|---|---|---|---|
| **`neondb_owner`** (the DBA) | you, in pgAdmin; `neon.ps1` (in memory) | everything Neon allows | — | **nowhere we store**: Neon console → Connect, when you need it |
| **`ozari_migrator`** | `prisma migrate deploy` (Cloud Build), `db-seed.ps1` | own the schema: CREATE / ALTER / DROP tables, indexes, constraints, sequences, views, functions, triggers; `setval()` | create roles or databases; join `neon_superuser`; touch other databases | `direct_database_url` → Secret Manager, read only by the Cloud Build SA |
| **`ozari_api`** | the running API (pooled) | SELECT / INSERT / UPDATE / DELETE on every table and view, `nextval()`, EXECUTE functions; triggers fire for it | any DDL, TRUNCATE, `setval()`, owning anything, `_prisma_migrations` | `database_url` → Secret Manager, read only by the Cloud Run SA |

**New tables need nothing.** The grants to `ozari_api` are the migrator's **default privileges**,
set while connected *as* the migrator. They fire for every table, sequence and function a future
migration creates. No re-run after a migration.

**Every `neon.ps1` run verifies.** It checks each role's attributes, that neither belongs to any group
(the check that catches `neon_superuser`), the schema rights, that the migrator owns every object in
`public` and the app owns none, full DML coverage, and the default privileges. A failure stops the
script **before** any URL is saved. Proven against real Postgres 18: the app's DDL, TRUNCATE,
setval, SET ROLE, CREATE ROLE/DATABASE are refused, and the migrator's CREATE ROLE/DATABASE and
`neon_superuser` self-grant are refused.

```powershell
./infrastructure/scripts/neon.ps1 staging -VerifyOnly              # re-prove it any time (read-only)
./infrastructure/scripts/neon.ps1 staging -RotateAppPassword       # then: tf.ps1 staging gcp plan/apply at once
./infrastructure/scripts/neon.ps1 staging -RotateMigratorPassword  # then: tf.ps1 staging gcp plan/apply at once
```

⚠️ A rotation takes effect in the database immediately; Secret Manager catches up at the gcp apply.
Run the apply straight after, or the API (or the next deploy) cannot log in in between.

**Rules for the DBA (pgAdmin):**
- Schema changes go through Prisma migrations, never by hand (CLAUDE.md §8).
- For an emergency fix, `SET ROLE ozari_migrator;` first, so the object keeps the right owner. If you
  forget, the next `neon.ps1` run hands anything you created in `public` to the migrator, and its
  verification flags it until then.
- `CREATE EXTENSION` needs `neon_superuser`. A migration that adds one needs that statement run by you
  first. None does today.

The app can connect to Neon's empty `postgres` maintenance database. Its CONNECT belongs to Neon's
own admin, not to us. Nothing can be created there (Postgres 15+), so this is harmless. On `neondb`,
CONNECT is revoked from PUBLIC and granted only to the two roles.

---

## 3b. Object storage (Cloudflare R2)

Product/asset **images** live in a Cloudflare **R2** bucket. R2 is S3-compatible; the backend uses
`@aws-sdk/client-s3` (helper: `src/helpers/storage.ts`, policy: `appConfig.storage`). **Reads are
public** (no private data); **writes/deletes** use credentials, and the browser uploads **directly to
R2 via a short-lived presigned PUT URL** the API mints — image bytes never pass through Cloud Run, so
the 10 kB body cap stands (the one exception, a 100 kB JSON cap on the product create/update bodies
that carry variations, is unrelated to images — `AUTH-AND-SECURITY.md` §1).

| | staging | production |
|---|---|---|
| Bucket | `ozari-staging-assets` | `ozari-prod-assets` |
| Public reads (`R2_PUBLIC_URL`) | `https://assets-stg.partyrentalsgt.com` | `https://assets.partyrentalsgt.com` |
| Location hint | `enam` (eastern North America, beside `us-east4`) | `enam` |

### The env vars (and which are secret)

| Env var | Kind | Where it comes from |
|---|---|---|
| `R2_ENDPOINT` | plain | derived: `https://<cloudflare_account_id>.r2.cloudflarestorage.com` (gcp root `main.tf`) |
| `R2_BUCKET_NAME` | plain | `envs/<env>/gcp/variables.tf` — must equal the cloudflare root's bucket |
| `R2_PUBLIC_URL` | plain | same file — must equal the cloudflare root's custom domain, **no trailing slash** |
| `R2_ACCESS_KEY` | **secret** | `r2_access_key` → Secret Manager `ozari-r2-access-key` |
| `R2_SECRET_KEY` | **secret** | `r2_secret_key` → Secret Manager `ozari-r2-secret-key` |
| ~~`R2_TOKEN`~~ | **not used** | the Cloudflare REST-API bearer; the **S3 SDK doesn't read it** — never create a secret for it |

**The frontend needs NO R2 credentials** — it uploads to the presigned URL and reads via `R2_PUBLIC_URL`.

### What is code and what is a click

**The bucket, its CORS policy and its custom domain are Terraform** (`modules/cloudflare-env/r2.tf`).
A custom domain is used in **every** environment: the bucket's `r2.dev` URL is rate-limited,
uncached, documented by Cloudflare as not-for-production, and dashboard-only. The CSP's `img-src`
already allows `*.partyrentalsgt.com`, so any asset host on the zone needs no CSP change.

**Only the API token is minted by hand**, because a Terraform-created token writes its secret into
state. That is also why Cloudflare is applied **before** GCP: the token can only be scoped to a
bucket that exists, and the gcp apply needs the token.

🔒 **Minting the token:** Cloudflare → R2 → *Manage R2 API Tokens* → Create → permission **Object
Read & Write**, **Apply to specific buckets only** → this environment's bucket. Then:

```powershell
./infrastructure/scripts/secret.ps1 staging r2_access_key   # Access Key ID
./infrastructure/scripts/secret.ps1 staging r2_secret_key   # Secret Access Key
```

**CORS is REQUIRED for uploads**: the browser PUTs to the presigned URL directly (a cross-origin
request to the S3 endpoint), so a missing or stale origin fails every gallery upload at preflight
while the rest of the app looks healthy. Declared per environment (`r2_cors_allowed_origins`), PUT
only, header `content-type`, max-age 3600:

- **staging:** `http://localhost:5173` (local dev uploads to the staging bucket) +
  `https://staging.partyrentalsgt.com`
- **production:** `https://partyrentalsgt.com` **only — never localhost**

CORS is a *browser gate*, not the upload authorization — that is the presigned signature
(admin-minted, 5-min TTL, bound to key + type + size). Listing localhost on staging grants nothing
without an admin session; keeping it off production means a compromised dev machine's browser
context can't even preflight against prod assets.

Public **reads** have their OWN rule, `public-reads` (2026-10-29): GET/HEAD from **any** origin. The
catalog's `<img>` tags never needed it, but the printed documents `fetch` each line's product photo
(`ozari-app` `documentImages.ts`) to re-encode it for react-pdf — a CORS request. The objects are
already public and no credentials ride along, so an allowlist would protect nothing, and `*` keeps
the edge cache from serving one origin's CORS answer to another. Missing it (or the read host in the
CSP `connect-src`), the PDFs still generate — **without photos**. After the first apply, purge the
image host's cache if staging still prints none.

**The CSP is the OTHER browser gate, and it is checked first.** The app's `connect-src`
(`ozari-app/index.html`) pins the exact write host `https://<account-id>.r2.cloudflarestorage.com`,
so presigned URLs MUST be **path-style** (`…/<bucket>/<key>`) — the API's S3 client sets
`forcePathStyle: true` (`helpers/storage.ts`, pinned by a test). The SDK default is virtual-hosted
(`<bucket>.<account-id>.r2…`), which the CSP refuses: DevTools shows the PUT as **`(blocked:csp)` in
0 ms**, the product saves without its photos, and nothing reaches R2 or its CORS rule (this shipped
to staging and prod until 2026-10-13). Moving to another Cloudflare account therefore changes the
CSP line in the same commit (the comment above it says so).

**The second presign trap — checksums.** AWS SDK v3 ≥ 3.729 adds a CRC32 to every `PutObject` by
default, and in a PRESIGNED URL it is computed over an empty body (`x-amz-checksum-crc32=AAAAAA==`
in the query string), so R2 rejects the real file. The client sets
`requestChecksumCalculation`/`responseChecksumValidation: "WHEN_REQUIRED"` (Cloudflare's documented
R2 setting; also pinned by a test). Diagnostics: a presigned URL opened in a browser tab always
answers `SignatureDoesNotMatch` — it is signed for PUT and the tab sends GET — so that XML proves
nothing; read the URL's host and query parameters instead.

---

## 3c. Custom domains & first-party cookies (SESSION-CRITICAL)

> **Why this is not cosmetic.** The 30-day refresh token lives in an HttpOnly cookie set by the API.
> If the frontend and the API sit on **different registrable domains** (`*.pages.dev` vs
> `*.run.app`), that cookie is a **third-party cookie**: Safari/iOS (all WebKit) and Firefox/Brave in
> strict mode refuse to store or send it. The visible symptom is not an error — it is a user being
> bounced to the login screen every time the 15-minute access token expires, with no way to silently
> rehydrate. Desktop Chrome currently tolerates it, which is exactly why this hides until a driver
> opens the app on an iPhone. **Serving both halves under one registrable domain fixes it at the
> root** — the cookie becomes first-party and every browser keeps it.

### The naming scheme

| Environment | Frontend (`APP_HOST`) | API (`VITE_API_URL`) | Assets (`R2_PUBLIC_URL`) |
|---|---|---|---|
| **staging** | `https://staging.partyrentalsgt.com` | `https://api-staging.partyrentalsgt.com` | `https://assets-stg.partyrentalsgt.com` |
| **production** | `https://partyrentalsgt.com` (apex) | `https://api.partyrentalsgt.com` | `https://assets.partyrentalsgt.com` |
| **local** | `http://localhost:5173` | *(none — Vite proxies `/api` → `localhost:3000`)* | the staging bucket |

Both halves of a pair share `partyrentalsgt.com`, so the cookie is first-party. **Keep every host to
ONE label** (`api-staging.`, not `api.staging.`): Cloudflare's Universal SSL covers the apex plus a
single subdomain level only, and a two-level host would need a paid advanced certificate. The module
rejects a two-level hostname at plan time.

### Putting a domain in front of Cloud Run — why a Worker

Something in the middle must rewrite the `Host` header before the request reaches Google, because
**DNS resolves, it does not redirect**: the browser still sends `Host: api-staging.…`, one IP serves
every Cloud Run service, and that header is the only thing identifying yours. Unknown host ⇒ 404.
(It must be a PROXY, not a redirect — a 3xx would land the browser back on `run.app` and re-create
the third-party-cookie bug this whole exercise exists to fix.)

| Option | Cost | Verdict |
|---|---|---|
| **Cloudflare Worker** ⭐ | **free** (100K req/day) | What we ship. A proxied `CNAME` + a Worker route that rewrites the hostname on a subrequest — which carries BOTH the `Host` header and the SNI. |
| Cloud Run domain mapping | free | `us-east4` supports it, but Google documents mappings as *preview, "not production-ready and not supported at General Availability"* **in every region**. Not adopted. |
| Cloudflare Origin Rules / Snippets | **Pro, US$20/mo** | The Host/SNI rewrite fields are visible on Free but paywalled on click. Don't plan around either on a Free zone. |
| Global external Application LB + serverless NEG | ~US$18–25/mo | Google-native and Terraform-able, but bills hourly whether or not anyone visits — more than the rest of this infra combined. |

**The Worker's target is Cloud Run's DETERMINISTIC hostname**, `ozari-api-<project_number>.us-east4.run.app`,
computed by the cloudflare root from the project number in the bootstrap state. It is known before
the service is ever deployed, which is what lets the edge be applied first; until the first deploy
the API host simply answers 404/503.

> **Workers free-plan ceiling — the one step-cost in the stack.** 100,000 requests/day (~3M/month)
> per account, shared by both environments. A small rental business is far below it. If it were
> ever reached, requests beyond it fail until the daily reset; the fix is Workers Paid (US$5/month
> flat), the only line in this stack that is not pay-per-use.

> **`trust proxy` / rate limiting — the visitor's address.** The rate limiters key on `req.ip`. A
> Worker subrequest does NOT carry the visitor in `X-Forwarded-For`, so the Worker writes it there
> itself from `CF-Connecting-IP` (set by Cloudflare, not forgeable by the client; it replaces, never
> appends to, whatever the client sent). Google's front end appends the Cloudflare address, Express
> sees `<visitor>, <cloudflare-egress>`, and `app.ts` trusts **2** hops. *Found on the 2026-10-13
> rebuild:* with the earlier `trust proxy = 1` and no header from the Worker, every request logged
> `ips: ["104.23.x.x"]` — one bucket for the whole app (30 public requests/minute, 10 sign-ins/minute,
> for everyone together). **Verify after every rebuild** (§3c.4 step 6): a Cloud Run request log's
> `jsonPayload.ips` must show your own public IP. Residual gap: a caller that skips Cloudflare and
> hits the `run.app` address can put any address there (open; `AUTH-AND-SECURITY.md` §12).

### 3c.1 — What the cloudflare stack builds

All of it is declared in `infrastructure/terraform/modules/cloudflare-env/` and applied with
`tf.ps1 <env> cloudflare plan` → `apply`. **Do not perform any of it by hand** — a console edit is
reverted by the next apply.

| What | Where | The constraint that made it tricky |
|---|---|---|
| API CNAME → the run.app host, **Proxied** | `dns.tf` | ⚠️ One label, with a hyphen (above). Grey-clouded, the Worker route never runs and Google answers 404. |
| The proxy Worker (`ozari-<env>-api-proxy`) | `worker.tf` + `worker/api-proxy.js.tftpl` | `cloudflare_worker` + `_worker_version` + `_workers_deployment`; the old `cloudflare_workers_script` is deprecated. |
| Its route, `<api host>/*` | `worker.tf` | ⚠️ A **route**, not a Custom Domain — a Custom Domain creates its own DNS record and collides with the CNAME. The pattern names the host exactly; the dashboard's pre-filled `*.partyrentalsgt.com/*` would proxy the FRONTEND into the API. |
| `workers.dev` subdomain **off** | `worker.tf` | Otherwise the API has a second public address that bypasses the zone's protections. |
| SSL **Full (strict)**, Always Use HTTPS | `zone.tf` | Zone-wide, so **production alone** owns them (`manage_zone_settings`); staging never sets them. |
| R2 bucket + **CORS** + custom domain | `r2.tf` | §3b. Cloudflare creates the custom domain's DNS record itself. |
| Pages project (`ozari-<env>`), **Git source**, custom domain, **`VITE_API_URL`** | `pages.tf` | ⚠️ Vite inlines `VITE_API_URL` at BUILD time — Terraform setting it is necessary, not sufficient: run `pages-build.ps1`. Previews are **off** (two projects on one repo would otherwise build each other's branches); watch path `ozari-app/*`. The DNS record targets the project's real `*.pages.dev` subdomain, which may carry a random suffix. |
| `X-Robots-Tag: noindex` on the staging host | `zone.tf` | `public/robots.txt` ships `Allow: /`, so without this a crawler indexes the staging app under the brand domain. |

**What is still manual here:** the Cloudflare API token Terraform authenticates with (stored as
`cloudflare_api_token` in `account.json`, exported only to the `tf.ps1` process), and the R2 access
key pair. The account-level GitHub authorization for Pages already exists; if it were ever revoked,
the Pages resource fails on its `source` — connect any project to GitHub once in the dashboard,
delete it, and re-apply.

**"already exists" on a cloudflare apply** means a hostname is still held by something else (a
leftover DNS record, an old Pages custom domain, an old route). `cf-inventory.ps1 <env>` names every
CONFLICT and how to remove it. Nothing belonging to `qa-ulew` is ever listed as anything but
*not ours*.

### 3c.2 — GCP side

`APP_HOST` and `API_PUBLIC_URL` are Terraform variables (`envs/<env>/gcp/variables.tf`), applied to
both the Cloud Run service and the build trigger from one place. Change one there, `tf.ps1 <env> gcp
plan` → `apply`, then redeploy the API so a new revision picks it up — verify on *Revisions →
Variables*.

> While `APP_HOST` names the wrong origin, the API **rejects** the frontend with a CORS/API-key
> failure. If the frontend host is live and every call fails, check this first.

### 3c.3 — What lives in the repo

| Thing | Where | Why it matters |
|---|---|---|
| CSP `connect-src` | `ozari-app/index.html` | A CSP blocks what it doesn't name; the app looks dead. Lists both API hosts + the exact R2 write endpoint (pinned by account id). No `run.app` fallback: a DNS rollback also needs a Pages rebuild, which is the right trade for not carrying a standing exception. |
| CSP response headers | `ozari-app/public/_headers` | `frame-ancestors`, `sandbox` and `report-uri` are IGNORED in a `<meta>` tag, so they live here (with `X-Frame-Options`, `nosniff`, `Permissions-Policy`, HSTS). Framing only; the full CSP stays in `index.html`. |
| `_SET_ENV_VARS` fallback | `ozari-api/cloudbuild.yaml` | Used only by a manual `gcloud builds submit` with no trigger; every trigger run overrides it. |
| `app_host` / `api_public_url` | `envs/<env>/gcp/variables.tf` | Terraform owns the trigger substitution and the service env from these. |
| Email logo | `ozari-api/src/config/app.ts` | **Derived** from `APP_HOST` — nothing to edit, and it can't go stale. |
| `VITE_API_URL` | `envs/<env>/cloudflare/main.tf` (`ozari-app/.env.example` documents it locally) | Inlined at build time. |

**Local development is deliberately untouched.** The dev server calls `/api` on its own origin (Vite
proxies to `localhost:3000` — `client.ts` uses `/api` whenever `import.meta.env.DEV`), so `'self'`
already satisfies the CSP, no `VITE_API_URL` is read, `APP_HOST` stays `http://localhost:5173` in
your local `.env`, and the cookie stays `SameSite=Lax; Secure=false` because `isDeployedEnvironment()`
is false.

### 3c.4 — Acceptance test (the actual gate)

0. **The API answers on its own hostname first** — check this before touching the frontend:
   `https://api-staging.partyrentalsgt.com/api/health/check`.
   Read the answer, it localises the fault precisely:
   · **200** (with `x-api-key`) or **403** from OUR API ⇒ correct — a 403 means Express received it
     and `validateApiKey` refused a direct browser hit, which is the intended behaviour.
   · **404**, Google-styled ⇒ the Host rewrite isn't happening (route or proxy status wrong), or the
     service has not been deployed yet.
   · **SSL alert 40 / 525 / 526** ⇒ TLS, not routing: a two-level hostname (no certificate) or an
     encryption mode below Full (strict).
1. `https://staging.partyrentalsgt.com` loads; DevTools **Console shows no CSP violation** and
   **Network** shows calls going to `api-staging.partyrentalsgt.com` (not `run.app`).
2. Sign in. In *Application → Cookies*, `refresh-token` is listed under
   **`api-staging.partyrentalsgt.com`** with `HttpOnly`, `Secure`, `Path=/api/auth`.
3. Upload a product photo (proves the R2 credentials AND the CORS origin).
4. **On a real iPhone (Safari):** log in → background the tab for **>15 minutes** → reopen. The panel
   must rehydrate **with no login screen**. Repeat in Firefox with Enhanced Tracking Protection on
   *Strict*. If either bounces to login, the cookie is still third-party — stop and re-check that
   both hosts really are under `partyrentalsgt.com`.
5. Trigger a password-reset email and confirm the link and the logo point at the environment's
   frontend origin.
6. Hit any endpoint ~40 times in a minute from one browser; confirm you are limited and a *different*
   device is not (the `trust proxy` note above). Quicker and exact: Logs Explorer →
   `resource.type="cloud_run_revision" AND jsonPayload.ips:*` → `ips` must be YOUR public IP
   (`https://api.ipify.org`), never a `104.x`/`172.x` Cloudflare address.

### 3c.5 — Optional hardening, once every environment is same-site

`appConfig.cookieConfig` still sends `SameSite=None; Secure` in deployed environments. That is
**correct and sufficient** — `None` is about *sending* the cookie cross-site, while the blocking that
killed mobile sessions was about the cookie being *third-party*, which the shared domain has fixed.
Tightening to `Lax` buys a little defence-in-depth and is safe **only** once no deployed frontend
talks to an API on another registrable domain. It is a one-line change in `app.ts` — deliberately
not bundled with an infrastructure change, so that if sessions misbehave there is exactly one
variable in flight.

---

## 3d. Google Calendar OAuth (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)

The calendar integration (`EPIC-2-CALENDAR.md`) writes each order's delivery and collection into an
admin's own Google Calendar, and keeps them in step for the rest of the order's life. Without these
two variables `GET /calendar` answers `googleAvailable: false` and the settings screen offers only
the ICS subscription.

> ⚠️ **Deployed environments always carry a client.** `tf.ps1` refuses a gcp plan with any empty
> secret, so the OAuth client is created **before** the first gcp apply (`REBUILD.md` §4 orders it).
> The ICS-only state remains what a local `.env` without the pair gives you.

**There is no SDK, no service account and no JSON key file.** The backend talks to three documented
Google endpoints with `fetch`, and every grant is authorised **per user, by that user**, through
OAuth 2.0. Nothing here needs billing enabled.

**Both halves are stored as Secret Manager secrets**, including the client ID. The ID is not itself
secret (it travels in the consent URL), but binding it beside its secret means the pair is loaded,
rotated and revoked as ONE credential — splitting it across a plain env var and a secret is how half
a rotated client ends up live. `GOOGLE_CLIENT_SECRET` is a **server-side** value: it must never
reach a `VITE_*` variable, the frontend bundle, or git.

### What the implementation actually does (verified against the code)

| Question | Answer | Where |
|---|---|---|
| Where are the credentials read? | `process.env` on every call, never cached at module load | `calendar/google.service.ts` → `googleCredentials()` |
| Start of the flow | `GET /api/calendar/google/authorize` — **Admin only** (`verifyJwt` + `isGrantedRoles([Admin])`); returns `{ authorizeUrl }` as JSON, the SPA then navigates to it | `calendar.route.ts`, `calendar.controller.ts` |
| Callback | `GET /api/calendar/google/callback` — mounted **before** the API-key check with its own 20/min limiter, because it arrives as a top-level browser navigation from Google carrying no header, cookie or origin of ours | `app.ts` → `mountCalendarPublicRoutes` |
| Callback authentication | The signed `state` JWT (HS256 on `JWT_SECRET`, 10-minute TTL, `purpose: "calendar-connect"` so an access token cannot be replayed into it) | `signState` / `readState` |
| Scopes requested | `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/userinfo.email` — exactly these two, nothing else | `appConfig.calendar.google.scopes` |
| Offline access | `access_type=offline`, `prompt=consent`, `include_granted_scopes=true` | `buildGoogleAuthUrl` |
| Token storage | `calendar_connections`, unique per `(user_id, provider)`. The refresh token, access token and account email are **AES-256-GCM encrypted at rest** (`*_kms` columns, the `ENCRYPTION_KEY` scheme). Events are written to `calendar_id`, default `"primary"` | `schema.prisma`, callback handler |
| Refresh handling | A refresh persists the new access token, and writes `refresh_token_kms` **only when Google returns one** — Google omits it on an ordinary refresh, and writing `undefined` over the stored grant would disconnect the calendar on the first renewal | `calendar.sync.ts` → the token accessor |
| Revoked grant | `invalid_grant` deactivates the connection instead of retrying forever | `GoogleGrantRevokedError` |
| Disconnect | Hard-deletes the row and revokes the grant with Google (best effort). Events already written are deliberately **left** in the calendar | `DELETE /api/calendar/google` |

The connected Google account has **no relationship to the admin's login email** and need not share
our domain — an admin may link any Google account they control, including a personal Gmail one. The
account address is stored (encrypted) only so the UI can show WHICH account is linked.

### 🔒 One-time Google Cloud configuration — per environment, in THAT environment's project

**One OAuth client per environment, created in the environment's own GCP project**
(`ozari-staging-gt`, `ozari-prod-gt`). The client that existed before the rebuild lived in the old
staging project and is deleted with it.

| Client | Project | Redirect URIs |
|---|---|---|
| staging | `ozari-staging-gt` | local + staging (one client is enough to develop against) |
| production | `ozari-prod-gt` | production **only** |

Separate clients mean a mistake in staging's redirect list can never touch production, and the two
environments are different identities in Google's eyes. The cost is one consent screen to publish
per environment — and only production's needs publishing and verification (staging stays in Testing,
with its test users listed). Nothing in the code differs: the client is entirely an environment value.

Google's console reorganises periodically (the OAuth settings now live under **Google Auth
Platform**). The *shape* below is stable; where a label has moved, follow what the console shows.

**1. Project + API.** Select the environment's project. Enable the **Google Calendar API**
(APIs & Services → Library). No other API is required — the account-email lookup is a plain
userinfo endpoint.

**1b. Branding — the USER-facing name.** App name = the brand exactly as the site shows it
(`Party Rentals Gt`, the `<title>` in `ozari-app/index.html`), never "Ozari" (the internal code
name). It is what the consent screen says ("*Party Rentals Gt* wants to access your Google
Account"), and Google's verification checks it against the homepage. The support email is shown too.
The OAuth client's name and the project's name are internal and never shown.

**2. Audience → `External`.** Google Auth Platform → *Audience* → User type **External**.

> This application is **not** owned by a Google Workspace / Cloud Identity organisation, and an admin
> connects whichever Google account they want. `Internal` is only available to a Workspace
> organisation and would restrict connections to accounts inside it — **do not select it** unless the
> ownership model itself changes.

**3. Test users (Testing only).** While the app is in **Testing**, only accounts listed under
Google Auth Platform → *Audience* → *Test users* can complete consent; anyone else gets
`access_denied`. Add each developer/admin account that will test the flow.

> ⚠️ **Testing mode is not a production state.** Google currently issues refresh tokens with a
> limited lifetime (about **7 days**) to apps in Testing that request scopes like ours. The visible
> symptom is not an error: the calendar syncs for a week and then quietly stops, and every admin has
> to reconnect. Only moving the app out of Testing changes this (see the publishing checklist below).

**4. Data Access → scopes.** Google Auth Platform → *Data Access* → add exactly:

```
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/userinfo.email
```

These are what the code requests, so anything else configured here is either unused or a mismatch the
consent screen will show the admin. **We deliberately do NOT request
`https://www.googleapis.com/auth/calendar`**: `calendar.events` already covers reading and writing
events, which is the whole feature, while the broader scope also grants creating, renaming and
deleting entire calendars. Least privilege here is not decoration — a broader scope makes Google's
verification review heavier and is displayed to the admin at the moment they decide whether to trust
us.

**5. Client.** Google Auth Platform → *Clients* → **Create OAuth client** → application type **Web
application**. Name it for what it is, e.g. `Ozari Google Calendar (staging)`. The client **secret
stays server-side** — the SPA never sees it, because the whole flow is backend-driven.

**6. Authorized redirect URIs.** These are the only URLs Google will return the browser to. The path
is `appConfig.basePath` + the route, i.e. always `/api/calendar/google/callback`:

```
local:      http://localhost:3000/api/calendar/google/callback          (staging client)
staging:    https://api-staging.partyrentalsgt.com/api/calendar/google/callback
production: https://api.partyrentalsgt.com/api/calendar/google/callback (prod client)
```

Google matches a redirect URI **exactly** — scheme, host, port, path and trailing slash all count,
and `http` vs `https` or `api-staging` vs `staging-api` are different URIs. The mismatch surfaces as
a `redirect_uri_mismatch` page **on Google's side**, which our code never sees and therefore cannot
report. The same URI is sent twice (once for consent, once for the code exchange) and both come from
`googleRedirectUri(publicBaseUrl(req))`, so the two can never disagree with each other — only with
what is registered.

⚠️ **The host must be the one `API_PUBLIC_URL` names** (§2). Behind the Cloudflare Worker the
request reaches Cloud Run with `Host: …run.app`, so with `API_PUBLIC_URL` unset the backend would
build its redirect from the `run.app` name — a URI nobody registered. It is set per environment in
`envs/<env>/gcp/variables.tf` (`api_public_url`), which also keeps the URI stable if the Cloud Run
URL ever changes.

**7. Authorized JavaScript origins — leave empty.** They are not needed here, and the fact that our
frontend is a SPA/PWA is not a reason to add them:

- **JavaScript origins** matter when the *browser* runs Google's OAuth/API client directly.
- **Redirect URIs** are where Google sends the authorization callback.

Our flow is backend-driven end to end: the SPA only navigates to a URL the backend built, and Google
returns to the **backend**. The backend then redirects the browser to
`<APP_HOST>/panel/ajustes?calendario=conectado|error` — that hop is ours, entirely separate from
Google's authorized redirect list, and the frontend origin must **not** be added to it.

**8. Store the pair:**

```powershell
./infrastructure/scripts/secret.ps1 staging google_client_id
./infrastructure/scripts/secret.ps1 staging google_client_secret
```

### Where the two variables live, per environment

| Environment | Mechanism |
|---|---|
| **local** | `ozari-api/.env` (gitignored; keys documented in `.env.example`). Use the **staging** client's values; leave `API_PUBLIC_URL` empty — nothing fronts the dev server, so the redirect derives from the request and matches the `localhost:3000` entry by construction. Leaving the pair empty locally gives the ICS-only state. |
| **staging / production** | `google_client_id` / `google_client_secret` in `infrastructure/secrets/<env>.json` → Secret Manager `ozari-google-client-id` / `-secret`, bound to Cloud Run by `modules/gcp-env/secrets.tf` and forwarded by `cloudbuild.yaml`'s computed `--set-secrets`. |

**The IAM binding comes from the same registry.** The runtime SA has no project-level secret access;
each secret flagged `run_access` in `secrets.tf` gets its own accessor binding in `iam.tf`. A deploy
binding a secret the SA cannot read fails at revision creation — which is why a new secret is one
registry entry and never a hand-edited list.

**Rotation** = `secret.ps1 <env> google_client_id` / `google_client_secret` (each bumps its rotation
counter) → `tf.ps1 <env> gcp plan` → `apply` → redeploy (`:latest` resolves at revision creation, not
per request). A rotated client invalidates existing grants, so every connected admin reconnects once.

### Post-deploy smoke test

1. After the values are in place and the API redeployed, confirm on the revision's *Variables* tab
   that both are bound.
2. Sign in as an **Admin** → **Ajustes → Calendarios**. A "Conectar" button (rather than the
   ICS-only state) means the backend reports `googleAvailable: true`.
3. Click connect → Google asks which account to use.
4. **Read the consent screen**: it must request Calendar *events* access and your email address, and
   nothing more. Anything broader means the console's Data Access config and the code disagree.
5. Grant it. The callback must return you to `/panel/ajustes?calendario=conectado` with no
   `redirect_uri_mismatch` on the way.
6. The settings screen shows the connected Google account's address.
7. Create an order with a delivery date and check the event appears in that calendar, at the
   logistics block's window (`at − gap/2` … `at + gap/2`) with a reminder.
8. Exercise the sync's other paths: edit the order's delivery time (the event moves), advance it past
   the delivery (the event disappears — only PENDING events are written), rewind (it comes back),
   cancel or delete the order (its events go).
9. Wait out a cold start and repeat a change — stored credentials must survive, since they live in
   the database, not in memory.
10. **Verify the refresh path**, which is the one failure that hides for an hour: after more than an
    hour without activity (the access token's life), make another change and confirm the event still
    updates. In logs, a successful renewal is silent; a failure logs the sync error.

### Production publishing & Google verification

Production's client is created in `ozari-prod-gt` with the prod redirect URI only. Then:

```
1. Store the pair in secrets/prod.json and apply — part of REBUILD.md §4 for prod.
2. Move the PROD OAuth app OUT of Testing and complete Google's verification for the scopes.
   ← the only step with an external dependency; start it as soon as the prod client exists.
3. Re-run the smoke test above against production, including the >1h refresh check.
```

Step 2 is Google's and takes days — and until it lands, a production calendar syncs for about a week
per connection and then stops.

Because the app is **External** and Calendar access can be classified as sensitive, a production
rollout has requirements beyond our own infrastructure. Google's rules and console change — treat the
list below as the shape of the work and **follow what Google Auth Platform / the Verification Center
shows at the time you deploy**:

**Prerequisites that are CODE (owner decision 2026-10-13: production is published and verified, no
test users — admins and employees who are not developers connect calendars):** Google rejects a
home page that is only a login screen, and `/` currently redirects to `/sesion/inicio`. So before
Branding can be completed: a PUBLIC home page at `https://partyrentalsgt.com` saying what the app
does, linking a PUBLIC privacy policy (`/privacidad`, including Google's *Limited Use* disclosure for
Calendar data) and terms (`/terminos`). Plus domain ownership: Google Search Console → Domain
property `partyrentalsgt.com` → its TXT record, verified by the same Google account that owns
`ozari-prod-gt`. "Publish app" stays disabled until Branding is complete.

**Interim (until those pages ship):** production goes live in **Testing**, with each admin's Google
account under *Audience → Test users*. It works, with two costs: the "unverified app" screen
(click *Continue*), and the ~7-day refresh-token expiry — every connected admin reconnects weekly
(*Ajustes → Calendarios*). Once published, delete the test users; they no longer matter.

Later scopes: adding one = add it under Data Access + resubmit; what is already verified keeps
working during that review. Avoid RESTRICTED scopes (Gmail content, full Drive): they add a paid
yearly security assessment.

```
[ ] Google Auth Platform → Branding: app name "Party Rentals Gt", support email, logo, home page,
    privacy policy URL, terms URL and authorized domain partyrentalsgt.com — all for PRODUCTION
[ ] Data Access lists ONLY calendar.events + userinfo.email, each with a justification
    that matches what the app does
[ ] The production redirect URI is registered:
    https://api.partyrentalsgt.com/api/calendar/google/callback
[ ] google_client_id / google_client_secret are in secrets/prod.json and applied
[ ] The OAuth app is moved OUT of Testing — otherwise refresh tokens expire in ~7 days and
    production sync stops weekly
[ ] Every requirement shown in the Verification Center is completed (scope justification,
    domain ownership, a demo video and a review are all possible asks for sensitive scopes;
    plan for days, not minutes)
[ ] A real production OAuth run with an authorized Google account, end to end
[ ] An event created by the deployed system is visible in that calendar
[ ] The connection still works after the access token expires (refresh renewal proven)
```

**A working test-user flow is not approval.** It proves the wiring; it says nothing about whether the
app may serve users outside the test list, or whether its refresh tokens will outlive the week.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `redirect_uri_mismatch` on Google's page | The URI the backend built is not registered on THIS environment's client. It is `<API_PUBLIC_URL or the request's own origin>/api/calendar/google/callback` — compare it character by character with the console list, and check `API_PUBLIC_URL` on the revision (behind the Worker, an unset value yields the `run.app` host). |
| `access_denied`, or an account cannot authorize | The app is in Testing and that Google account is not under *Audience → Test users*. Add it, or publish the app. |
| The settings screen offers only the ICS feed | `googleAvailable: false` ⇒ one or both variables are missing from the **backend** environment. Check the revision's Variables tab, then that the secret has a version and the run SA can read it. Redeploy after fixing. |
| Connecting succeeds, then sync stops days later | Either the app is still in Testing (7-day refresh tokens), or the grant was revoked from the Google account (the code marks the connection inactive on `invalid_grant`; reconnecting is the fix). |
| The consent screen asks for the wrong permissions | The console's *Data Access* scopes disagree with `appConfig.calendar.google.scopes`. The code is the authority on what is requested; align the console to it. |
| "google returned no refresh token" in the logs | Google withheld one because the account had already granted this client and the request lost `prompt=consent`. The code refuses to store such a connection (it would die within the hour). Revoke the app's access in the Google account's *Third-party apps* and connect again. |
| Consent works, but the return lands nowhere useful | The backend's final hop uses `APP_HOST`. A stale `APP_HOST` sends the admin to the wrong frontend origin. |

---

## 4. The URL chicken-and-egg — dissolved

The backend needs the frontend origin; the frontend needs the backend URL; the edge needs the Cloud
Run hostname. None of these is a manual copy step any more:

- **`APP_HOST`** and **`VITE_API_URL`** are both your own domain, decided up front (§3c) and
  committed in the environment roots. Neither depends on anything being deployed.
- **The Worker's target** is Cloud Run's deterministic hostname, computed from the project number the
  bootstrap produced — known before the first deploy. So the order is
  **bootstrap → cloudflare → gcp → first build**, and the cloudflare apply needs nothing from GCP but
  the bootstrap state.

> **Email logo dependency (soft):** `appConfig.email.logoUrl` is **derived from `APP_HOST`**
> (`<frontend-origin>/email-logo.png`). Emails render the logo once the **frontend is deployed** with
> that asset at that origin; with `APP_HOST` unset it is `""` and the text wordmark carries the brand.

---

## 5. Building an environment — see `REBUILD.md` §4

The complete, ordered first build (both staging and production) is
[`REBUILD.md`](./REBUILD.md) §4: accounts and credentials, `tf.ps1 <env> bootstrap`, `neon.ps1`,
`new-secrets.ps1`, the cloudflare apply, the R2 token and the OAuth client, the gcp apply, the first
build, `db-seed.ps1`, `pages-build.ps1`, and the verification list. Prerequisites on the operator's
machine: `gcloud` (logged in, plus `gcloud auth application-default login`), **Terraform ≥ 1.11**
(1.16.5 is current), Node 22 + `pnpm` with `pnpm install` done in `ozari-api` (the Neon script uses
its `pg` driver). `psql` is **not** needed.

---

## 6. Cloud Build substitutions & env ownership (the "param replacement")

`cloudbuild.yaml` is parameterised by **substitutions**, and **Terraform owns every one of them**
(`modules/gcp-env/cloud-build.tf`). The YAML's literals are fallbacks for a manual
`gcloud builds submit` with no trigger; a real deploy always overrides them. To change `APP_HOST` — or
anything else the runtime reads — you edit **Terraform**, never the Console:

1. Edit `envs/<env>/gcp/variables.tf` → `tf.ps1 <env> gcp plan` → review → `tf.ps1 <env> gcp apply`
   → redeploy (§7).

**The rule that used to bite, and why it no longer can.** Both `terraform apply` and
`gcloud run deploy --set-env-vars` do a **full replacement** of the environment. Two hand-kept copies
of that list is a rule you can follow perfectly for a year and break once, after which a deploy
silently drops a variable an apply had set.

There is only one list. `modules/gcp-env/locals.tf` derives **`_SET_ENV_VARS`** and
**`_SET_SECRETS`** from the same declarations that define the Cloud Run service, and the YAML
forwards them verbatim:

```yaml
- --set-env-vars=${_SET_ENV_VARS}
- --set-secrets=${_SET_SECRETS}
```

So **adding a runtime env var is one line in `locals.tf`**, and adding a secret is one entry in
`secrets.tf` (plus its key in `infrastructure/templates/env.example.json`) — which also gives it its
container, its version, its IAM and its Cloud Run binding. ⚠️ **Do not expand those substitutions
back into a literal list in the YAML.** That is the bug, not the documentation of it.

Terraform deliberately **ignores the container image tag** — Cloud Build owns it (each build deploys
`:$COMMIT_SHA`). `tf.ps1 <env> gcp output` (see `runtime_env_contract`) shows what an environment
runs with, without opening a console.

---

## 7. Ongoing releases

| | staging (`ozari-staging-gt`) | production (`ozari-prod-gt`) |
|---|---|---|
| **Backend** | push to `dev` touching `ozari-api/**` → trigger `ozari-api-staging` | merge to `main` touching `ozari-api/**` → trigger `ozari-api-prod` |
| **Frontend** | push to `dev` touching `ozari-app/*` → Pages `ozari-staging` | merge to `main` touching `ozari-app/*` → Pages `ozari-prod` |

The backend pipeline: verify (`pnpm install --frozen-lockfile` + `build` + `type-check`) → build +
push image → **`prisma migrate deploy`** as `ozari_migrator` (a no-op when none are pending) → deploy.
Zero manual steps for a normal release.

**Run a deploy without a push** (after a secret rotation, or the very first deploy):

```powershell
gcloud builds triggers run ozari-api-staging --branch=dev --region=us-east4 --project=ozari-staging-gt
gcloud builds triggers run ozari-api-prod   --branch=main --region=us-east4 --project=ozari-prod-gt
./infrastructure/scripts/pages-build.ps1 staging     # frontend: after a build-variable change
```

### Changing a secret

Every rotation is the same three moves — the value changes in the file **with its counter bumped**,
Terraform pushes a new Secret Manager version and destroys the old one, and a redeploy makes Cloud
Run resolve `:latest` again:

```powershell
# 1. new value (pick the one that applies)
./infrastructure/scripts/secret.ps1 staging email_key                 # any dashboard-minted value
./infrastructure/scripts/new-secrets.ps1 staging -Rotate jwt_secret   # generated values
./infrastructure/scripts/neon.ps1 staging -RotateAppPassword          # the app's DB password

# 2. push it
./infrastructure/scripts/tf.ps1 staging gcp plan     # expect: the one secret version replaced
./infrastructure/scripts/tf.ps1 staging gcp apply

# 3. redeploy (gcloud builds triggers run …, above)
```

A value edited in the file **without** a counter bump is inert — Terraform cannot see a write-only
value change — so a typo in the file can never silently rotate a live credential. The scripts bump
the counter for you; editing the JSON by hand does not.

⚠️ Rotating `jwt_secret`/`jwt_refresh_secret` logs everyone out. `encryption_key` is **never**
rotated while the environment holds data. The GitHub PAT (`github_oauth_token`) is rotated the same
way before it expires — a dead PAT shows up as a trigger that stops firing.

### Changing infrastructure

Scaling, a new env var, IAM: edit the module or the env root → `tf.ps1 <env> <stack> plan` → review →
`apply`. Rehearse on staging first; production gets the identical change with `prod`.

---

## 8. Migrations strategy (dev ↔ prod)

**The one invariant:** `prisma/migrations/` is a **single, linear, append-only history**, and it is the
**same set** of migrations applied to every environment. Prisma records each applied migration (name +
checksum) in `_prisma_migrations`; two environments diverge the instant their migration folders differ.
**Never keep separate dev/prod migration directories** — that guarantees drift. You may rewrite history
**only on the tail that has not been deployed anywhere yet**; once a migration has run in prod, it is
**frozen forever**.

### 8a. First launch — squash to a clean baseline (one-time, optional)
Right before prod exists (prod DB empty, nothing applied), the accumulated dev feature migrations can
be collapsed into ONE baseline so prod starts clean and dev + prod share one history:

1. `schema.prisma` is the source of truth. Delete the folders inside `prisma/migrations/` (keep
   `migration_lock.toml`).
2. Generate one baseline with the engine diff — the file must be written by a Prisma command, never
   typed (CLAUDE.md §8):
   ```sh
   mkdir prisma/migrations/00000000000000_init
   pnpm prisma migrate diff --from-empty \
     --to-schema prisma/schema.prisma --script \
     -o prisma/migrations/00000000000000_init/migration.sql
   ```
3. **Prod** (empty): the first pipeline run applies this baseline for real.
4. **Staging and dev** (to match): both are rebuilt or reset — staging's database is disposable, so a
   fresh Neon project (or `pnpm prisma migrate reset` on a dev DB) re-applies the baseline. *Never
   `reset` prod.* (To preserve a DB's data instead, baseline it:
   `prisma migrate resolve --applied 00000000000000_init`.)
5. Commit. Now every environment is identical at `00000000000000_init`.

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

Everything not listed is identical — same modules, same scripts, same pipeline file.

| Thing | Staging | Production |
|---|---|---|
| GCP project | `ozari-staging-gt` | `ozari-prod-gt` |
| Terraform state | `gs://ozari-staging-gt-tfstate` (`ozari/bootstrap`, `ozari/cloudflare`, `ozari/gcp`) | `gs://ozari-prod-gt-tfstate` (same prefixes) |
| Env inputs | `envs/staging/environment.json` + `{bootstrap,cloudflare,gcp}/` | `envs/prod/…` |
| Secrets file | `infrastructure/secrets/staging.json` | `infrastructure/secrets/prod.json` — **every value distinct** |
| Neon project | `ozari-staging` | `ozari-prod` (quotas are per project, so staging cannot eat prod's) |
| Cloud Run `max_instances` (the spend cap) | 2 | 3 |
| Registry cleanup | keep 2 / 14-day stale window | keep 3 / 30-day stale window |
| Build trigger | `ozari-api-staging`, branch `dev` | `ozari-api-prod`, branch `main` |
| `NODE_ENV` | `staging` | `production` (disables `/api/docs`) |
| `APP_HOST` / `VITE_API_URL` | `staging.` / `api-staging.` | apex / `api.` |
| Pages project / Worker | `ozari-staging` / `ozari-staging-api-proxy` | `ozari-prod` / `ozari-prod-api-proxy` |
| R2 bucket / public host | `ozari-staging-assets` / `assets-stg.` | `ozari-prod-assets` / `assets.` |
| R2 CORS origins | localhost + staging origin | **prod origin only — never localhost** |
| Zone settings (SSL strict, Always HTTPS) | not managed | **owned here** |
| `X-Robots-Tag: noindex` | on | off |
| Google OAuth client | own client in its project; stays in Testing | own client in its project; **published + verified** |
| Frontend CSP `connect-src` | `index.html` already lists both API hosts | same file — no per-env build |

---

## 10. Rollback & emergencies

- **Backend rollback:** redeploy a previous image —
  `gcloud run deploy ozari-api --image <IMAGE>:<goodSHA> --region us-east4 --project <project>`
  (every build is tagged `:$COMMIT_SHA` in Artifact Registry; the cleanup policy always keeps the
  newest few). **Note:** a rollback does **not** undo a migration — forward-only. Design migrations
  to be backward-compatible across one release if you want safe rollbacks.
- **Frontend rollback:** Cloudflare Pages → the project → Deployments → "Rollback to this deployment".
- **Database:** Neon keeps a restore window (point-in-time restore) per project; use it from the Neon
  console. Restoring under a different owner means re-running `neon.ps1` (default privileges, §3).
- **Console edits are emergency-only:** Terraform is the source of truth; a manual Console change is
  reverted on the next `apply`. If you must, fold the change back into Terraform immediately.
- **Never** run `terraform destroy` casually. There is no destroy verb in `tf.ps1` on purpose, and the
  project itself carries `deletion_policy = PREVENT`. Retiring an environment is `REBUILD.md`.
- **Lost `infrastructure/secrets/`** with no backup: everything except `encryption_key` can be
  re-minted (rotate each). `encryption_key` cannot — the encrypted columns of that database are gone.
  This is why the directory is backed up off the machine.

---

## 10b. Security incidents — see `INCIDENTS.md`

A leaked credential, an account takeover, a flood, deleted data, a bad deploy: the scenarios, what to
do in the first minutes and the commands are in `INCIDENTS.md`. The one-command credential rotation
is `infrastructure/scripts/rotate.ps1 <env>` (INCIDENTS.md §2).

---

## 11. Production launch gates (beyond the REBUILD.md §6 verification)

The build itself is `REBUILD.md` §4 for `prod`. These are the things only production adds:

```
[ ] staging rebuilt with the same procedure and its verification list fully green FIRST
[ ] `main` created from `dev`; the prod trigger and Pages project both build from it
[ ] infrastructure/secrets/prod.json: EVERY value distinct from staging (new-secrets.ps1 prod,
    its own Resend key, its own R2 token, its own OAuth client, its own GitHub PAT)
[ ] cf-inventory.ps1 prod shows no CONFLICT — the apex must not be held by anything else
[ ] the prod cloudflare plan is the ONLY one touching zone settings (staging never does)
[ ] /api/docs ABSENT on https://api.partyrentalsgt.com (NODE_ENV=production)
[ ] the §3c.4 acceptance test on the apex, including the iPhone >15-minute session gate
[ ] Calendar: the prod OAuth app moved OUT of Testing and Google's verification started (§3d) —
    until it lands, sync dies after ~7 days
[ ] infrastructure/secrets/ backed up OFF this machine, including prod.json's encryption_key
[ ] (optional) enable_cleanup_job = true in envs/prod/gcp once there are real users
```

---

## 12. Spending limits — every provider (and how to change each)

**Rule (owner, 2026-10-14):** nothing usage-based may bill past its limit. Where a provider can
**stop** at the limit, it does. Where it cannot, we get an email. Only the **domains** (annual
registrar fees, not usage) are expected on the Cloudflare bill.

| Provider · scope | What could cost money | At the limit | Enforced by | Warning |
|---|---|---|---|---|
| **Google Cloud** · per environment | Cloud Run, Secret Manager, Artifact Registry, Cloud Build, the cap function | 🛑 **US$5/month**: billing is unlinked and every Google service in that project stops | our function (`modules/gcp-env/spend-cap.tf`) | emails at 50 / 90 / 100 % |
| **Neon** Free · per project | nothing — the Free plan never bills | 🛑 100 CU-hours/month → compute suspended until the 1st; 1 GB storage → writes fail; 5 GB transfer → suspended | Neon itself | console → project → **Usage** |
| **Resend** Free · ONE account for both environments | nothing — no overage on Free | 🛑 100 emails/day, 3,000/month → sends refused (password reset and similar fail until the UTC day / month rolls over) | Resend itself | dashboard → **Usage** |
| **Cloudflare Workers** Free · whole account | nothing | 🛑 100,000 requests/day across BOTH API proxies → API calls fail until 00:00 UTC | Cloudflare itself | — |
| **Cloudflare Pages** Free · whole account | nothing | 🛑 500 builds/month → builds wait for next month | Cloudflare itself | — |
| **Cloudflare R2** · whole account | storage over 10 GB, writes over 1M, reads over 10M per month | ⚠️ **keeps billing — Cloudflare has no hard cap for R2** | nobody | the account **budget alert** (below) |
| GitHub, Google Calendar API, Google sign-in | nothing (free, quota-limited) | requests refused | the provider | — |

**Why R2 having no stop is a small risk:** writes need a signed-in admin or driver, one short-lived,
size-capped presigned URL per file; reads are cached at the edge. To spend US$5 past the free tier
takes ~333 GB stored, ~1.1M extra writes, or ~14M uncached reads (~5 per second for a whole month);
US$10,000 would take billions of requests. An abnormal month shows up in the budget alert the next
day, and `pnpm reconcile:images` / `pnpm purge:evidence` shrink storage.

**Note on the stops:** each one is an outage *by design* — the trade the owner chose over an open
bill. Google's and Neon's are per environment (staging cannot use up production's); Resend's,
Workers' and Pages' are per ACCOUNT, so staging traffic spends production's quota too.

### 🔒 One-time: the Cloudflare budget alert (1 minute, account-wide)

Cloudflare → **Manage Account → Billing → Billable Usage → Create budget alert** — name
`ozari-usage`, threshold **US$1**, your email → **Save**. It counts usage-based spend only (R2,
Workers overage), not subscriptions or domain registrations, and fires the day after usage is
processed. If Cloudflare already created its default US$10 alert, edit that one down to US$1
instead. (Per-product "Usage Based Billing" notifications need a Pro zone; this replaces them.)

### Changing a limit — ask Claude "change the <env> <provider> limit to X", then run the commands

| Change | Steps |
|---|---|
| **Google cap** (e.g. prod to US$10) | Claude edits `monthly_budget_usd` in `envs/<env>/gcp/variables.tf` (whole dollars, ≥ 1) → you: `tf.ps1 <env> gcp plan` (expect ONLY `google_billing_budget.cap` changing in place) → `apply` → commit. Each environment is independent. |
| **Google cap after it FIRED** | `INCIDENTS.md` S12 (find out why → raise it as above → `tf.ps1 <env> bootstrap plan` + `apply` re-links billing). |
| **Cloudflare alert** | Billing → Billable Usage → the alert → edit the threshold. |
| **Neon** (outgrowing Free) | No higher hard cap exists: Neon's paid plans bill overage and their spending limit only **emails** (automatic suspension is announced, not shipped). Upgrading = Neon → Billing → Launch, then set the organization's **spending limit** to the new ceiling. Decide it deliberately. |
| **Resend** (outgrowing 100/day) | Resend → Settings → Billing → Pro (US$20/month, 50,000 emails). Keep **overages OFF** so it still stops at the quota. |
| **Workers** (outgrowing 100k/day) | Workers Paid is US$5/month flat with overage billing and no cap — `INFRASTRUCTURE-PLAN.md` §8 lists the cheaper alternative first. |

Disabling a stop is never a quiet change: whoever does it updates this table in the same commit.

---

**See also:** `infrastructure/README.md` (layout, the scripts, day-to-day operation),
`INFRASTRUCTURE-PLAN.md` (automation map, cost model, decisions), `REBUILD.md` (build and teardown),
`CLAUDE.md` (architecture, auth, secrets facts), `ozari-api/README.md` / `ozari-app/README.md`
(local dev).
