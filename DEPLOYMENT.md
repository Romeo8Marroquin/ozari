# Ozari — Deployment Runbook

The end-to-end, dependency-ordered guide for deploying Ozari — **from zero to a running
environment** and for **ongoing releases**. It ties together the pieces that live in
`infrastructure/` (Terraform + scripts), `ozari-api/cloudbuild.yaml`, and the third-party
services (Neon, Cloudflare, Resend).

> **Scope.** Staging is **live** and adopted under Terraform (`infrastructure/terraform/envs/staging/`).
> **Production does not exist yet** — this document is the plan to create it perfectly when the time
> comes. Nothing here provisions prod on its own.

> **This file is the RUNBOOK — what to do, in what order, with which console.**
> [`INFRASTRUCTURE-PLAN.md`](./INFRASTRUCTURE-PLAN.md) is the **plan to make most of it unnecessary**:
> which of these steps can become Terraform, which never can (the Google OAuth client, secret values,
> the GitHub App install), the ordered bootstrap for a fresh environment, the staging
> teardown-and-rebuild, and the measured cost model. When a step below moves into Terraform, it is
> deleted from here and recorded there — the two must never describe the same step differently.

> **Public-repo safety.** This repo is public. **No secret values, connection strings, keys, or state
> ever go in git.** Every sensitive value is created out-of-band and stored in Secret Manager
> (backend) or the Cloudflare dashboard (frontend). Steps that must be done by hand for this reason
> are marked **🔒 manual**.

---

## 1. The moving parts (and who owns what)

| Component | Purpose | Managed by |
|---|---|---|
| **GCP project + state bucket** | Where an environment lives. | Terraform (`terraform/bootstrap`) |
| **Neon (PostgreSQL)** | The database. Two URLs: **pooled** (runtime, least-privileged) + **direct** (migrations, owner). | 🔒 manual project creation + `scripts/db-bootstrap.*` for the role. ⚠️ Deliberately NOT the Neon TF provider — a role it creates is auto-granted `neon_superuser` and can do DDL. |
| **GCP Secret Manager** | Holds all backend secret values. | **Terraform — containers, IAM AND versions.** Values reach it via write-only arguments and never enter state (Terraform >= 1.11). |
| **GCP Artifact Registry** | Stores the API Docker image. | Terraform, with **cleanup policies** that keep it inside the free tier |
| **GCP Cloud Build** | CI/CD pipeline: verify → build → migrate → deploy. | Terraform owns the **connection, trigger and every substitution**; steps in `ozari-api/cloudbuild.yaml` |
| **GCP Cloud Run** | Runs the API container. | Terraform owns **structure**; Cloud Build owns the **image tag** |
| **Cloudflare Pages** | Builds + hosts the frontend, serves the apex domain. | Terraform (project, custom domain, `VITE_API_URL`). 🔒 The GitHub OAuth authorization is a one-time click. |
| **Cloudflare Worker + DNS** | Puts the brand hostname in front of Cloud Run by rewriting `Host`. | Terraform |
| **Cloudflare R2** | Public object storage for asset images. S3-compatible. | Terraform (bucket, **CORS**, custom domain). 🔒 The API token is minted by hand — a TF-created one lands in state. |
| **Resend** | Transactional email (welcome, reset, security). Domain `partyrentalsgt.com` is verified. | 🔒 manual API key per env; its **DNS records are Terraform** |
| **Google OAuth client** (Calendar) | Consent screen + client credentials. | 🔒 **manual, permanently** — no API exists (§3d) |

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
| `ozari-r2-access-key` | `R2_ACCESS_KEY` | R2 S3 **Access Key ID** (see §3b) | API runtime |
| `ozari-r2-secret-key` | `R2_SECRET_KEY` | R2 S3 **Secret Access Key** (see §3b) | API runtime |
| `ozari-google-client-id` | `GOOGLE_CLIENT_ID` | Google OAuth **client ID** (see §3d) | API runtime |
| `ozari-google-client-secret` | `GOOGLE_CLIENT_SECRET` | Google OAuth **client secret** (see §3d) | API runtime |

Plain (non-secret) runtime env vars: `NODE_ENV`, `LOG_LEVEL`, `APP_HOST`, `API_PUBLIC_URL`, and the
three R2 URL/name vars `R2_ENDPOINT`/`R2_BUCKET_NAME`/`R2_PUBLIC_URL` (§3b). `PORT` is injected by
Cloud Run (8080).

> **`APP_HOST` and `API_PUBLIC_URL` are not the same host.** `APP_HOST` is the **frontend** origin
> (CORS, the API-key origin check, email links). `API_PUBLIC_URL` is the **API's own** origin, and it
> exists because the Cloudflare Worker in front of Cloud Run rewrites the `Host` header to the
> `run.app` name (§3c): the calendar's OAuth redirect URI and the ICS feed URL an admin pastes into
> their phone are built from it, and neither may name `run.app`. Empty ⇒ derived from the request,
> which is correct only for a deployment with nothing in front of it. No trailing slash (§3d).
**Frontend:** `VITE_API_URL` (set 🔒 manually in Cloudflare Pages). **Not used:** `R2_TOKEN` (§3b).

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

### Cloudflare — what is code and what is a click

**The bucket, its CORS policy and its custom domain are Terraform** (`modules/cloudflare-env/r2.tf`).
An earlier version of this runbook said the CORS policy might have no Terraform resource; it does —
`cloudflare_r2_bucket_cors`. **Only the API token is minted by hand**, because a Terraform-created
token writes its secret into state.

1. ~~Create the bucket~~ → `r2.tf`.
2. **Public read**: a custom domain is `r2_custom_domain` in the cloudflare stack (recommended for
   prod, e.g. `https://assets.partyrentalsgt.com`); the bucket's `r2.dev` URL is dashboard-only.
   Either way the result is `R2_PUBLIC_URL` in the gcp stack.
3. 🔒 **Create an R2 API token** scoped to that bucket (Object Read & Write) → the **Access Key ID**
   (`r2_access_key`) and **Secret Access Key** (`r2_secret_key`) go into the environment's gitignored
   `secrets.auto.tfvars`. The **Account ID** is in the endpoint.
4. ~~Set the CORS policy~~ → `r2_cors_allowed_origins`. It is REQUIRED for uploads: the browser PUTs
   to the presigned URL **directly** (a cross-origin request to the S3 endpoint), so a missing or
   stale origin fails every gallery upload at preflight while the rest of the app looks healthy. The
   declared origins are (no trailing slash):

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:5173", "https://staging.partyrentalsgt.com"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   > Updated 2026-07-31 for the custom-domain cutover (§3c). The old `https://ozari-c28.pages.dev`
   > origin can stay listed while DNS rollback is still a possibility, and should be removed once
   > `staging.partyrentalsgt.com` is the only way in — this list is the bucket's whole browser gate.

   Public **reads** don't need CORS (plain `<img>` tags aren't CORS requests). If a feature ever
   needs to `fetch` an image from the app origin (e.g. attaching a photo as a Web Share Level 2
   file — tried and removed 2026-07: share sheets lead with links), add `"GET"` here first.

   **Per-environment origins (security):** CORS here is a *browser gate*, not the upload
   authorization — that is the presigned signature (admin-minted, 5-min TTL, bound to key + type +
   size), so listing `localhost` grants an attacker nothing without an admin session. Still, keep
   buckets scoped: the **staging** bucket lists `http://localhost:5173` (local dev uploads to it) +
   the Pages origin; the future **production** bucket must list ONLY the production origins —
   **never localhost** — so a compromised dev machine's browser context can't even preflight
   against prod assets. Add the apex domain when the frontend moves.

### Ordered rollout

> **The old two-phase apply is gone.** It existed because a Cloud Run binding to `:latest` on a
> secret with no version fails the deploy, and secret values were loaded out-of-band — so the
> operator had to remember to apply the containers, load the values, then apply the rest. Terraform
> now owns the versions too, and the service `depends_on` them, so the ordering is an edge in the
> graph rather than a step you can forget.

```
1. Plain values → infrastructure/terraform/envs/<env>/gcp/terraform.tfvars   (gitignored)
      r2_endpoint / r2_bucket_name / r2_public_url

2. Credentials → the same directory's secrets.auto.tfvars                    (gitignored)
      r2_access_key / r2_secret_key

3. ./scripts/tf.ps1 <env> gcp apply

4. Redeploy the API so the new revision picks up the env (push to the build branch, or re-run
   the trigger).
```

Only `R2_ACCESS_KEY` / `R2_SECRET_KEY` are secrets; the three `R2_*` URL/name vars are **plain** and
flow to both Cloud Run and the build trigger from one variable. `R2_TOKEN` (the Cloudflare REST-API
bearer) is **not used at all** — the S3 SDK does not read it.

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

| Environment | Frontend (`APP_HOST`) | API (`VITE_API_URL`) |
|---|---|---|
| **staging** | `https://staging.partyrentalsgt.com` ✅ live | `https://api-staging.partyrentalsgt.com` |
| **production** (later) | `https://partyrentalsgt.com` | `https://api.partyrentalsgt.com` |
| **local** | `http://localhost:5173` | *(none — Vite proxies `/api` → `localhost:3000`)* |

Both halves of a pair share `partyrentalsgt.com`, so the cookie is first-party. **Keep every host to
ONE label** (`api-staging.`, not `api.staging.`): Cloudflare's Universal SSL covers the apex plus a
single subdomain level only, and a two-level host would need a paid advanced certificate.

### Putting a domain in front of Cloud Run — the constraint

**Cloud Run domain mappings are NOT available in `northamerica-south1`** (verified against Google's
docs, 2026-07-31 — the feature exists only in `asia-east1`, `asia-northeast1`, `asia-southeast1`,
`europe-north1`, `europe-west1`, `europe-west4`, `us-central1`, `us-east1`, `us-east4`, `us-west1`).
So the mapping has to come from somewhere else:

Something in the middle must rewrite the `Host` header before the request reaches Google, because
**DNS resolves, it does not redirect**: the browser still sends `Host: api-staging.…`, one IP serves
every Cloud Run service, and that header is the only thing identifying yours. Unknown host ⇒ 404.
(It must be a PROXY, not a redirect — a 3xx would land the browser back on `run.app` and re-create
the third-party-cookie bug this whole exercise exists to fix.)

| Option | Cost | Verdict |
|---|---|---|
| **Cloudflare Worker** ⭐ | **free** (100K req/day) | What we shipped. A proxied `CNAME` + a Worker route that rewrites the hostname on a subrequest — which carries BOTH the `Host` header and the SNI. |
| Cloudflare Origin Rules / Snippets | **Pro, US$20/mo** | The "proper" declarative way — and the trap: the Host/SNI rewrite fields are visible on Free but paywalled on click. Snippets are Pro+ too. Don't plan around either on a Free zone. |
| Global external Application LB + serverless NEG | ~US$18–25/mo | Google-native, Google-managed cert, Terraform-able. Bills hourly whether or not anyone visits — more than the rest of this infra costs. |
| Move the service to a mapping-capable region | free | ⚠️ **Re-checked 2026-09-01 and this is no longer an escape hatch.** Google now documents domain mappings as *"not production-ready and not supported at General Availability"* — **in every region**, not just the ones that lack them — and recommends a load balancer or Firebase Hosting instead. The *latency* argument still stands on its own (Neon lives in `us-east-1`, so `us-east4` would cut DB round trips from ~60–80 ms to ~1–5 ms at the cost of ~30 ms on one client hop) — but decide that as a latency question, because it no longer buys native domain mapping worth having. |

> **`trust proxy` / rate limiting.** `app.ts` sets `trust proxy = 1`, and the login + global rate
> limiters key on `req.ip`. Cloudflare inserts one more hop into `X-Forwarded-For` (it forwards the
> client and Google appends the Cloudflare edge, so `trust proxy = 1` should still resolve the real
> client). **Verify after cutover** (§3c.4): if `req.ip` ever resolves to a Cloudflare address, every
> visitor shares one bucket and the limiter throttles the whole app at once. The fix is a
> `keyGenerator` reading `CF-Connecting-IP` — do it only if the check shows it's needed.

### 3c.1 — This is Terraform now (was a nine-step console procedure)

⚠️ **Everything that used to be clicked here is declared in
`infrastructure/terraform/modules/cloudflare-env/`.** Apply it with
`./scripts/tf.ps1 <env> cloudflare apply`. The steps are kept below as a description of *what gets
built and why*, because the constraints are still real and a reviewer of that plan needs them —
but do not perform them by hand. A console edit will be reverted by the next apply.

| What | Where it is declared | The constraint that made it tricky |
|---|---|---|
| `api-staging` CNAME → the run.app host, **Proxied** | `dns.tf` | ⚠️ **One label, with a hyphen.** `api.staging.…` is two levels; Universal SSL covers the apex plus ONE, so Cloudflare flags *"not covered by a certificate"* and every request dies with `SSL alert 40 / handshake_failure` before reaching the Worker. Covering it needs Advanced Certificate Manager (~US$10/mo). The module rejects a two-level hostname at plan time. |
| The proxy Worker | `worker.tf` + `worker/api-proxy.js.tftpl` | The run.app hostname is read from the GCP state, not pasted. Uses `cloudflare_worker` + `_worker_version` + `_workers_deployment`; the old `cloudflare_workers_script` is deprecated. |
| Its route, `api-staging.partyrentalsgt.com/*` | `worker.tf` | ⚠️ A **route**, not a Custom Domain — a Custom Domain creates its own DNS record and collides with the CNAME. And the pattern must name the host exactly: the dashboard pre-fills `*.partyrentalsgt.com/*`, which would swallow the FRONTEND host and proxy the app into the API. |
| `workers.dev` subdomain **off** | `worker.tf` (`subdomain.enabled = false`) | Otherwise the API has a second public address that bypasses the zone's protections. |
| SSL mode **Full (strict)**, Always Use HTTPS | `zone.tf` | Zone-wide, so exactly one environment owns them (`manage_zone_settings`). |
| R2 bucket + **CORS** | `r2.tf` | The browser PUTs gallery photos straight to R2, so a stale origin breaks every upload at preflight while the rest of the app looks fine. |
| Pages project, custom domain, **`VITE_API_URL`** | `pages.tf` | ⚠️ Vite inlines it at BUILD time — Terraform setting it is necessary, not sufficient. **Redeploy the frontend afterwards.** |
| `X-Robots-Tag: noindex` on the staging host | `zone.tf` | `public/robots.txt` ships `Allow: /` for the future marketing site, so without this a crawler indexes the staging app under the brand domain. |

**What is still manual here:** minting the Cloudflare API token Terraform authenticates with, minting
the R2 access/secret key pair (a Terraform-created token would be written into state), and the
one-time OAuth click that authorizes Cloudflare Pages against GitHub.

### 3c.2 — GCP side

`APP_HOST` is a Terraform variable (`envs/<env>/gcp/variables.tf`), applied to both the Cloud Run
service and the build trigger from one place. Change it there, `apply`, then redeploy the API so the
new revision picks it up — verify on *Revisions → Variables*.

> **Order matters with the Pages step:** while `APP_HOST` still names the old origin, the API
> **rejects** the new frontend with a CORS/API-key failure. If the new frontend host is live and every
> call fails, this is why.

### 3c.3 — What changes in the repo (already committed, no action)

| Thing | Where | Why it must move in the same change |
|---|---|---|
| CSP `connect-src` | `ozari-app/index.html` | A CSP blocks what it doesn't name; the app looks dead. Lists both API hosts + the exact R2 write endpoint. **The `run.app` fallback was removed (2026-08-06)** now that `api-staging.` serves: a DNS rollback now also needs a Pages rebuild (one click, ~1 min), which is the right trade for not carrying a standing exception. |
| CSP response headers | `ozari-app/public/_headers` | `frame-ancestors`, `sandbox` and `report-uri` are IGNORED in a `<meta>` tag — they only work as real headers, so they live here (with `X-Frame-Options`, `nosniff`, `Permissions-Policy`, HSTS). It carries **framing only**; the full CSP stays in `index.html`, because two sources of one policy is how CSP bugs become unfindable. |
| `_APP_HOST` fallback | `ozari-api/cloudbuild.yaml` | Used by manual builds when no trigger substitution overrides it. |
| `app_host` default | `infrastructure/.../variables.tf` + `terraform.tfvars.example` | Terraform owns the trigger substitution; a stale default would revert the console edit on the next apply. |
| Email logo | `ozari-api/src/config/app.ts` | Now **derived** from `APP_HOST` — nothing to edit, and it can't go stale again. |
| `VITE_API_URL` | `ozari-app/.env.example` (local reference only) | Documents the value; the real one lives in Cloudflare Pages. |

**Local development is deliberately untouched.** The dev server calls `/api` on its own origin (Vite
proxies to `localhost:3000` — `client.ts` uses `/api` whenever `import.meta.env.DEV`), so: `'self'`
already satisfies the CSP, no `VITE_API_URL` is read, `APP_HOST` stays `http://localhost:5173` in
your local `.env`, and the cookie stays `SameSite=Lax; Secure=false` because `isDeployedEnvironment()`
is false. Pointing your local API at the staging Neon database changes none of this — the database
URL has nothing to do with origins.

### 3c.4 — Acceptance test (the actual gate)

0. **The API answers on its own hostname first** — check this before touching the frontend:
   `https://api-staging.partyrentalsgt.com/api/health/check`.
   Read the answer, it localises the fault precisely:
   · **200** (with `x-api-key`) or **403** from OUR API ⇒ correct — a 403 means Express received it
     and `validateApiKey` refused a direct browser hit, which is the intended behaviour.
   · **404**, Google-styled ⇒ the Host rewrite isn't happening: the Worker route doesn't match.
   · **SSL alert 40 / 525 / 526** ⇒ TLS, not routing: a two-level hostname (no certificate) or an
     encryption mode below Full (strict).
1. `https://staging.partyrentalsgt.com` loads; DevTools **Console shows no CSP violation** and
   **Network** shows calls going to `api-staging.partyrentalsgt.com` (not `run.app`).
2. Sign in. In *Application → Cookies*, `refresh-token` is listed under
   **`api-staging.partyrentalsgt.com`** with `HttpOnly`, `Secure`, `Path=/api/auth`.
3. Upload a product photo (proves the R2 CORS origin from step 4).
4. **On a real iPhone (Safari):** log in → background the tab for **>15 minutes** → reopen. The panel
   must rehydrate **with no login screen**. Repeat in Firefox with Enhanced Tracking Protection on
   *Strict*. If either bounces to login, the cookie is still third-party — stop and re-check that
   both hosts really are under `partyrentalsgt.com`.
5. Trigger a password-reset email and confirm the link and the logo point at
   `staging.partyrentalsgt.com`.
6. Hit any endpoint ~40 times in a minute from one browser; confirm you are limited and a *different*
   device is not (the `trust proxy` note above).

### 3c.5 — Optional hardening, once every environment is same-site

`appConfig.cookieConfig` still sends `SameSite=None; Secure` in deployed environments. That is
**correct and sufficient** — `None` is about *sending* the cookie cross-site, while the blocking that
killed mobile sessions was about the cookie being *third-party*, which the shared domain has now
fixed. Tightening to `Lax` buys a little defence-in-depth and is safe **only** once no deployed
frontend talks to an API on another registrable domain (e.g. Pages preview deployments). It is a
one-line change in `app.ts` — deliberately not bundled with the cutover, so that if sessions do
misbehave there is exactly one variable in flight.

---

## 3d. Google Calendar OAuth (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)

The calendar integration (`EPIC-2-CALENDAR.md`) writes each order's delivery and collection into an
admin's own Google Calendar, and keeps them in step for the rest of the order's life. It is **inert
without these two variables** — `GET /calendar` answers `googleAvailable: false`, and the settings
screen offers only the ICS subscription. That is a working product, just a slower one (a subscription
is read-only from the calendar's side and polls on the calendar app's own schedule), so shipping
without the OAuth client is a legitimate state, not a broken deploy.

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

### 🔒 One-time Google Cloud configuration

**What exists today (2026-08-31):** ONE Web-application client in the API's GCP project, carrying all
three redirect URIs (local, staging, production), audience **External**, still in **Testing**.

That is a deliberate simplification and it has a trade-off worth knowing before you change it. One
client means one consent screen, so **publishing/verification covers every environment at once** and
there is a single pair of values to load — at the cost that a mistake in its redirect list touches
production too, and that staging and production share the same client identity in Google's eyes.
Splitting them later is additive: create a second client holding only the prod URI, and load ITS
values into the prod secrets. Nothing in the code changes — the client is entirely an environment
value.

Google's console reorganises periodically (the OAuth settings now live under **Google Auth
Platform**). The *shape* below is stable; where a label has moved, follow what the console shows.

**1. Project + API.** Use the GCP project that owns the backend. Enable the **Google Calendar API**
(APIs & Services → Library). No other API is required — the account-email lookup is a plain
userinfo endpoint.

**2. Audience → `External`.** Google Auth Platform → *Audience* → User type **External**.

> This application is **not** owned by a Google Workspace / Cloud Identity organisation, and an admin
> connects whichever Google account they want. `Internal` is only available to a Workspace
> organisation and would restrict connections to accounts inside it — **do not select it** unless the
> ownership model itself changes.

**3. Test users (development only).** While the app is in **Testing**, only accounts listed under
Google Auth Platform → *Audience* → *Test users* can complete consent; anyone else gets
`access_denied`. Add each developer/admin account that will test the flow.

> ⚠️ **Testing mode is not a production state.** Google currently issues refresh tokens with a
> limited lifetime (about **7 days**) to apps in Testing that request scopes like ours. The visible
> symptom is not an error: the calendar syncs for a week and then quietly stops, and every admin has
> to reconnect. Registering the production redirect URI does **not** change this — only moving the
> app out of Testing does (see the publishing checklist below).

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
application**. Name it for what it is, e.g. `Ozari Google Calendar` (record the name you used, so the
next person recognises it in a list of clients). The client **secret stays server-side** — the SPA
never sees it, because the whole flow is backend-driven.

**6. Authorized redirect URIs.** These are the only URLs Google will return the browser to. The path
is `appConfig.basePath` + the route, i.e. always `/api/calendar/google/callback`:

```
local:      http://localhost:3000/api/calendar/google/callback
staging:    https://api-staging.partyrentalsgt.com/api/calendar/google/callback
production: https://api.partyrentalsgt.com/api/calendar/google/callback
```

Google matches a redirect URI **exactly** — scheme, host, port, path and trailing slash all count,
and `http` vs `https` or `api-staging` vs `staging-api` are different URIs. The mismatch surfaces as
a `redirect_uri_mismatch` page **on Google's side**, which our code never sees and therefore cannot
report. The same URI is sent twice (once for consent, once for the code exchange) and both come from
`googleRedirectUri(publicBaseUrl(req))`, so the two can never disagree with each other — only with
what is registered.

⚠️ **The host must be the one `API_PUBLIC_URL` names** (§2). Behind the Cloudflare Worker the
request reaches Cloud Run with `Host: …run.app`, so with `API_PUBLIC_URL` unset the backend would
build its redirect from the `run.app` name — a URI nobody registered. It is set for staging in
`cloudbuild.yaml` (`_API_PUBLIC_URL`) and `cloud-run.tf`, which also keeps the URI stable if the
Cloud Run URL ever changes.

**7. Authorized JavaScript origins — leave empty.** They are not needed here, and the fact that our
frontend is a SPA/PWA is not a reason to add them. The distinction:

- **JavaScript origins** matter when the *browser* runs Google's OAuth/API client directly.
- **Redirect URIs** are where Google sends the authorization callback.

Our flow is backend-driven end to end: the SPA only navigates to a URL the backend built, and Google
returns to the **backend**. The backend then redirects the browser to
`<APP_HOST>/panel/ajustes?calendario=conectado|error` — that hop is ours, entirely separate from
Google's authorized redirect list, and the frontend origin must **not** be added to it.

### Where the two variables live, per environment

| Environment | Mechanism | Where to set it |
|---|---|---|
| **local** | `ozari-api/.env` (gitignored; keys documented in `.env.example`) | Paste the values, restart `pnpm dev`. Leave `API_PUBLIC_URL` empty — nothing fronts the dev server, so the redirect derives from the request and matches the `localhost:3000` entry by construction. Leaving the client empty is fine too: the settings screen then offers only the ICS feed. |
| **staging** | Secret Manager `ozari-google-client-id` / `ozari-google-client-secret`, bound in `cloudbuild.yaml` (`--set-secrets`) **and** `cloud-run.tf` | The ordered rollout below. |
| **production** | Identical, in the prod project's own secrets (its own OAuth client) | §5 Step 2c + Step 5. |

The same OAuth client may carry the local and the staging redirect URIs, so one staging client is
enough to develop against. Production gets its own.

### Ordered rollout on a deployed environment

The container, the version, the IAM binding and the Cloud Run env are one declaration now
(`modules/gcp-env/secrets.tf`), and the service `depends_on` the versions — so the ordering that used
to require a targeted, values-first apply is handled by the dependency graph.

```
1. Put both halves in the environment's secrets.auto.tfvars (GITIGNORED):
      google_client_id     = "..."
      google_client_secret = "..."

2. ./scripts/tf.ps1 <env> gcp apply

3. Redeploy the API so a revision picks the values up (push to the build branch, or re-run the
   trigger). cloudbuild.yaml needs no change — it forwards the computed --set-secrets.
```

Shipping without the calendar is fine: leave both as empty strings (the keys must still be present)
and the API answers `googleAvailable: false`, offering only the ICS feed.

**The IAM binding is the step people skip.** The runtime SA has no project-level secret access — each
secret is granted individually in `iam.tf` (`run_sa_accessible_secrets`). A deploy binding a secret
the SA cannot read fails at revision creation.

**Rotation** = a new version on each secret, then a redeploy (`:latest` resolves at revision creation,
not per request). A rotated client invalidates existing grants, so every connected admin reconnects
once.

### Post-deploy smoke test

1. Redeploy/restart the backend after the variables are in place, and confirm on the revision's
   *Variables* tab that both are bound.
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
9. Restart the backend / wait out a cold start and repeat a change — stored credentials must survive,
   since they live in the database, not in memory.
10. **Verify the refresh path**, which is the one failure that hides for an hour: after more than an
    hour without activity (the access token's life), make another change and confirm the event still
    updates. In logs, a successful renewal is silent; a failure logs the sync error.

### Production publishing & Google verification

**What actually changes when prod arrives.** The console's redirect list already carries the prod URI,
so — assuming the single-client setup above — there is **nothing further to add there**. The work is:

```
1. Load GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET into the PROD secret store  (§5 Step 2c + Step 5)
   — same values as staging while one client serves both; different values if you split clients.
2. Prod Terraform carries the same two secret containers + IAM + Cloud Run bindings as staging,
   and API_PUBLIC_URL = https://api.partyrentalsgt.com  (copied from envs/staging, §5 Step 4).
3. Move the OAuth app OUT of Testing and complete Google's verification for the scopes.
   ← this is the only step with an external dependency; start it BEFORE you need it.
4. Re-run the smoke test above against production, including the >1h refresh check.
```

Steps 1–2 are ours and take minutes. Step 3 is Google's and takes days — and until it lands, a
production calendar syncs for about a week per connection and then stops. That is the whole reason it
appears this early in the runbook.

Because the app is **External** and Calendar access can be classified as sensitive, a production
rollout has requirements beyond our own infrastructure. Google's rules and console change — treat the
list below as the shape of the work and **follow what Google Auth Platform / the Verification Center
shows at the time you deploy**:

```
[ ] Google Auth Platform → Branding: app name, support email, logo, home page,
    privacy policy URL and authorized domains all accurate for PRODUCTION
[ ] Data Access lists ONLY calendar.events + userinfo.email, each with a justification
    that matches what the app does
[ ] The production redirect URI is registered:
    https://api.partyrentalsgt.com/api/calendar/google/callback
[ ] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET loaded into the PROD secret store (§5 Step 5)
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
| `redirect_uri_mismatch` on Google's page | The URI the backend built is not registered. It is `<API_PUBLIC_URL or the request's own origin>/api/calendar/google/callback` — compare it character by character with the console list, and check `API_PUBLIC_URL` on the revision (behind the Worker, an unset value yields the `run.app` host). |
| `access_denied`, or an account cannot authorize | The app is in Testing and that Google account is not under *Audience → Test users*. Add it, or publish the app. |
| The settings screen offers only the ICS feed | `googleAvailable: false` ⇒ one or both variables are missing from the **backend** environment. Check the revision's Variables tab, then that the secret has a version and the run SA can read it. Deploy or restart after fixing — the values are read at request time, but the container must have them. |
| Connecting succeeds, then sync stops days later | Either the app is still in Testing (7-day refresh tokens), or the grant was revoked from the Google account (the code marks the connection inactive on `invalid_grant`; reconnecting is the fix). Refresh responses omitting a refresh token are handled — the stored one is kept, never overwritten with `undefined`. |
| The consent screen asks for the wrong permissions | The console's *Data Access* scopes disagree with `appConfig.calendar.google.scopes`. The code is the authority on what is requested; align the console to it. |
| "google returned no refresh token" in the logs | Google withheld one because the account had already granted this client and the request lost `prompt=consent`. The code refuses to store such a connection (it would die within the hour). Revoke the app's access in the Google account's *Third-party apps* and connect again. |
| Consent works, but the return lands nowhere useful | The backend's final hop uses `APP_HOST`. A stale `APP_HOST` sends the admin to the wrong frontend origin. |

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

> **Email logo dependency (soft):** `appConfig.email.logoUrl` is **derived from `APP_HOST`**
> (`<frontend-origin>/email-logo.png`) — there is nothing to edit per environment, and it can no
> longer go stale when the frontend moves (it did: it still pointed at `pages.dev` after the move to
> `staging.partyrentalsgt.com`). Emails render the logo once the **frontend is deployed** with that
> asset at that origin; with `APP_HOST` unset it is `""` and the text wordmark carries the brand.

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
1. Create a **separate prod Neon project** (not a branch). The free plan allows 100 projects, and
   quotas — 100 CU-hours and 0.5 GB storage — are **per project**, so a staging load test cannot eat
   production's compute allowance.
2. Copy the **direct** (owner) connection string.
3. Run the role bootstrap; it generates the password, applies the grants, **proves** the result is
   least-privileged, and prints the pooled URL to paste into `secrets.auto.tfvars`:
   ```powershell
   ./infrastructure/scripts/db-bootstrap.ps1 -DirectUrl "<owner direct url>"
   ```
   ⚠️ **Do not create this role in the Neon console.** A role created through the console, API, CLI
   or the community Terraform provider is automatically granted `neon_superuser` — full DDL. It
   works perfectly and can drop your tables. `db-verify.sql` (run automatically here) is what
   catches that.

### Step 2 — 🔒 Resend key
Domain `partyrentalsgt.com` is already verified (shared account). Create a **separate prod API key**
in Resend → that value is `ozari-email-key`. (Senders are code config on the verified domain; no DNS
work needed.)

### Step 2b — 🔒 Cloudflare R2 (asset storage)
Create the prod bucket + public read (custom domain recommended) + an R2 API token — full detail in
**§3b**. This yields `R2_ENDPOINT`/`R2_BUCKET_NAME`/`R2_PUBLIC_URL` (plain → `terraform.tfvars`) and
`R2_ACCESS_KEY`/`R2_SECRET_KEY` (→ secrets `ozari-r2-access-key`/`ozari-r2-secret-key`).

### Step 2c — 🔒 Google Calendar OAuth client (optional feature, but do it here)
Create the **prod** OAuth client — full detail in **§3d**: enable the Calendar API, audience
**External**, the two `calendar.events` + `userinfo.email` scopes, a Web-application client, and the
prod redirect URI `https://api.partyrentalsgt.com/api/calendar/google/callback`. This yields
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (→ secrets `ozari-google-client-id`/
`ozari-google-client-secret`). It is done **now** because Step 4 binds those secrets and Step 5 loads
them; the publishing/verification work (§3d) runs in parallel and only gates *durable* production
sync, not the deploy. Skipping this step entirely is fine — the app ships with the ICS feed only.

### Step 3 — Generate the remaining secret values
```powershell
./infrastructure/scripts/new-secrets.ps1
```
Produces `jwt_secret`, `jwt_refresh_secret`, `encryption_key` (exactly 32 bytes hex) and `api_key`.
They go into `infrastructure/terraform/envs/prod/gcp/secrets.auto.tfvars` (**gitignored**), alongside
the R2 pair (§3b), the Resend key and the Google OAuth pair (§3d).

⚠️ **Every value must differ from staging.** A shared `jwt_secret` means a staging token
authenticates against production; a shared `encryption_key` means a staging dump decrypts production
PII. And `encryption_key` is generated **once and never rotated** — every `*_kms` column becomes
permanently unreadable if it changes.

### Step 4 — GCP project + Terraform (infra)
```powershell
# 1. Project + billing + state bucket, from code.
cp infrastructure/terraform/bootstrap/terraform.tfvars.example .../terraform.tfvars   # fill in
./infrastructure/scripts/tf.ps1 bootstrap - apply
#    → record project_id and project_number from the outputs

# 2. The environment itself.
cp infrastructure/terraform/envs/prod/gcp/terraform.tfvars.example .../terraform.tfvars  # fill in
./infrastructure/scripts/tf.ps1 prod gcp plan     # review
./infrastructure/scripts/tf.ps1 prod gcp apply
```

**There is no copying of directories.** `envs/prod/` holds inputs only; the resources live in the
shared module staging already uses, which is what stops the two environments from drifting.

One apply creates the APIs, the service accounts, IAM, Artifact Registry (with cleanup policies), the
secret containers **and their versions**, the Cloud Run service shell, the GitHub connection and the
build trigger (pointed at **`main`**). Prerequisites for the connection: the Cloud Build GitHub App
installed on the repository, and a GitHub PAT (REPO_ADMIN scope) in the secret named by
`github_oauth_token_secret_id`.

### Step 5 — ~~Load secret values~~ (no longer a step)
Terraform owns the secret versions, so they were created in Step 4 from `secrets.auto.tfvars`. The
old values-first, two-phase apply is gone: the Cloud Run service `depends_on` the versions, so the
ordering is part of the graph rather than something to remember. To rotate later, change the value
and bump its counter in `secret_version_triggers`.

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

### Step 8 — Frontend + edge (Cloudflare)
```powershell
cp infrastructure/terraform/envs/prod/cloudflare/terraform.tfvars.example .../terraform.tfvars
$env:CLOUDFLARE_API_TOKEN = "<token>"
./infrastructure/scripts/tf.ps1 prod cloudflare plan     # check against REBUILD.md §1 register
./infrastructure/scripts/tf.ps1 prod cloudflare apply
```
Creates the Pages project (build `pnpm build`, output `dist`, root `ozari-app`, branch `main`), its
custom apex domain, **`VITE_API_URL`**, the API's DNS record, the proxy Worker and its route, the R2
bucket with its CORS policy, and the zone's SSL settings. The Worker's target comes from the gcp
root's state, so nothing is copied from Step 6.

Then, by hand:
1. 🔒 Authorize Cloudflare Pages against GitHub (one OAuth click per account) if it has not been done.
2. **Redeploy the frontend.** ⚠️ `VITE_API_URL` is inlined at BUILD time — setting it changes nothing
   until the next build.
3. Confirm `ozari-app/public/email-logo.png` is served at `<origin>/email-logo.png`, and set
   `appConfig.email.logoUrl` to the prod origin (code change + redeploy backend).

### Step 9 — Verify
- `GET /api/health/check` → healthy.
- `/api/docs` is **absent** in prod (correct — production-gated).
- Smoke test: register → login → forgot-password (email arrives from Resend) → reset → login.
- Confirm CORS: the browser app talks to the API; a random Origin is rejected.
- If the calendar is configured: run the **§3d smoke test** (connect as Admin, check the consent
  screen's permissions, confirm an order's event lands in that calendar), then work through §3d's
  publishing checklist — a Testing-mode app syncs for about a week and then stops.

---

## 6. Cloud Build substitutions & env ownership (the "param replacement")

`cloudbuild.yaml` is parameterised by **substitutions**, and **Terraform owns every one of them**
(`modules/gcp-env/cloud-build.tf`). The YAML's literals are fallbacks for a manual
`gcloud builds submit` with no trigger; a real deploy always overrides them. To change `APP_HOST` — or
anything else the runtime reads — you edit **Terraform**, never the Console:

1. Edit `envs/<env>/gcp/variables.tf` (or the environment's `terraform.tfvars`) → `plan` → `apply`.

**The rule that used to bite, and why it no longer can.** Both `terraform apply` and
`gcloud run deploy --set-env-vars` do a **full replacement** of the environment. This file previously
told you to keep the list in `cloud-run.tf` and the list in `cloudbuild.yaml` identical by hand —
which is a rule you can follow perfectly for a year and break once, after which a deploy silently
drops a variable an apply had set.

Since 2026-09-01 there is only one list. `modules/gcp-env/locals.tf` derives **`_SET_ENV_VARS`** and
**`_SET_SECRETS`** from the same declarations that define the Cloud Run service, and the YAML forwards
them verbatim:

```yaml
- --set-env-vars=${_SET_ENV_VARS}
- --set-secrets=${_SET_SECRETS}
```

So **adding a runtime env var is one line in `locals.tf`**, and adding a secret is one entry in
`secrets.tf` — which also gives it its container, its version, its IAM and its Cloud Run binding.
⚠️ **Do not expand those substitutions back into a literal list in the YAML.** That is the bug, not
the documentation of it.

Terraform deliberately **ignores the container image tag** — Cloud Build owns it (each build deploys
`:$COMMIT_SHA`).

---

## 7. PART 2 — Ongoing releases (redeploy on `main` merge)

Once Part 1 is done, releases are **automated**:

- **Backend:** merge to `main` → the prod Cloud Build trigger fires → verify → build → **migrate
  deploy** (applies only new migrations; a no-op when none are pending) → deploy. Zero manual steps.
- **Frontend:** merge to `main` → Cloudflare Pages auto-builds and deploys.
- **Secrets/infra changes** are the only manual paths, and both are now the same one: put the new
  value in the environment's gitignored `secrets.auto.tfvars`, bump its counter in
  `secret_version_triggers`, and `apply` (then redeploy so the service picks up `:latest`). The
  superseded Secret Manager version is destroyed in the same operation.

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
| GCP project | `ozari-500103` | **separate project**, created by `terraform/bootstrap` |
| Terraform state | `ozari-500103-tfstate` / `ozari/staging` + `ozari/staging-cloudflare` | `ozari-prod-tfstate` / `ozari/prod` + `ozari/prod-cloudflare` |
| Terraform env dir | `envs/staging/{gcp,cloudflare}/` — inputs only | `envs/prod/{gcp,cloudflare}/` — inputs only, same shared module |
| Neon | its own project | **its own project** (free plan allows 100; quotas are per project) |
| Cloud Build GitHub connection | console-created, referenced by string | Terraform-managed (`manage_github_connection = true`) |
| Registry cleanup | keep 3 / 30-day stale window | keep 2 / 14-day stale window |
| Cloud Build trigger branch | dev branch | `main` |
| `NODE_ENV` | `staging` | `production` (disables `/api/docs`) |
| `APP_HOST` | `https://staging.partyrentalsgt.com` | apex domain, e.g. `https://partyrentalsgt.com` |
| Secrets | staging set | **separate** values (esp. a distinct Resend key + `ENCRYPTION_KEY`) |
| Frontend `VITE_API_URL` | `https://api-staging.partyrentalsgt.com` | `https://api.partyrentalsgt.com` |
| Frontend CSP `connect-src` | already lists both API hosts (`index.html`) | same file — no per-env build |
| R2 CORS `AllowedOrigins` | localhost + staging origin | **prod origin only — never localhost** (§3b.4) |
| Email `logoUrl` | *derived from `APP_HOST`* | *derived — nothing to change* |

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

**Order matters.** The domain work is split in two on purpose: `APP_HOST` must be right *before* the
frontend can talk to the API (CORS), and `VITE_API_URL` must be right *before* the frontend is built
(Vite inlines it). Getting these backwards is the one way to end up with a "deployed" app that can't
call its own backend.

```
[ ] 0  Decide the host PAIR up front — frontend + api MUST share the registrable domain, and each
       host must be ONE label (api.partyrentalsgt.com, never api.prod.partyrentalsgt.com — §3c)
[ ] 0  Separate prod GCP project decided
[ ] 1  terraform/bootstrap applied → prod project + billing + state bucket; record project_number
[ ] 1  Neon prod PROJECT created (not a branch); scripts/db-bootstrap.ps1 run → db-verify.sql PASSED
[ ] 2  Resend prod API key created
[ ] 2b R2 API token minted (bucket + CORS are Terraform; CORS must list ONLY prod origins — §3b)
[ ] 2c Google OAuth client for PROD (§3d): Calendar API on, audience External, scopes
       calendar.events + userinfo.email ONLY, Web-application client, prod redirect URI
       https://api.partyrentalsgt.com/api/calendar/google/callback  ← skip if not shipping calendar
[ ] 3  Cloud Build GitHub App installed + PAT stored; Cloudflare Pages authorized against GitHub
[ ] 3  scripts/new-secrets.ps1 → jwt x2, ENCRYPTION_KEY (32B hex), API_KEY into
       envs/prod/gcp/secrets.auto.tfvars (gitignored) — ALL values distinct from staging
[ ] 4  tf.ps1 prod gcp plan → REVIEW → apply. One pass: APIs, SAs, IAM, registry, secrets AND
       versions, Cloud Run shell, GitHub connection, main trigger. (No two-phase apply any more.)
[ ] 6  First build on main → verify/build/migrate/deploy
[ ] 7  pnpm db:seed once against the fresh prod DB
[ ] 8  tf.ps1 prod cloudflare plan → nothing outside REBUILD.md §1's OURS list → apply. Creates DNS,
       Worker + route (workers.dev off), SSL Full(strict), Pages + domain + VITE_API_URL, R2 + CORS
[ ] 8  Set manage_zone_settings = false in envs/staging/cloudflare — exactly one env owns them
[ ] 8  VERIFY the API on its own host BEFORE touching the frontend: /api/health/check (§3c.4 step 0)
[ ] 9  TRIGGER A FRONTEND REBUILD — VITE_API_URL is inlined at build time; setting it is not enough
[ ] 9  email-logo.png served from the prod origin
[ ] 10 Confirm APP_HOST on the prod Cloud Run revision == the prod FRONTEND origin, no trailing slash
[ ] 10 index.html CSP connect-src already lists api.partyrentalsgt.com — confirm before the build
[ ] 10 CSP connect-src pins the R2 WRITE endpoint by account id — if prod uses a DIFFERENT
       Cloudflare account, add its endpoint too (reads need nothing: R2_PUBLIC_URL is our own
       domain, already covered by *.partyrentalsgt.com in img-src)
[ ] 11 Verify: /api/health/check, /api/docs ABSENT (NODE_ENV=production), register→login→reset smoke
       test, a product photo upload (proves R2 CORS), and the §3c.4 iPhone >15min session gate
[ ] 11 Calendar (if shipped): §3d smoke test — connect as Admin, consent shows ONLY events+email,
       an order's event lands in the calendar, and it still syncs an hour later (refresh works)
[ ] 12 Calendar (if shipped): move the OAuth app OUT of Testing and complete whatever the Google
       Verification Center asks for the sensitive scope — until then sync dies after ~7 days (§3d)
```

`appConfig.email.logoUrl` is **no longer a checklist item** — it derives from `APP_HOST`.

---

**See also:** `infrastructure/README.md` (Terraform ownership rules, config-change checklist,
hardening TODOs), `infrastructure/terraform/envs/staging/README.md` (the staging env), `CLAUDE.md`
(architecture, auth, secrets facts), `ozari-api/README.md` / `ozari-app/README.md` (local dev).
