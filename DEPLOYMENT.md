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
| **Cloudflare R2** | Public object storage for asset images (product photos, …). S3-compatible. | 🔒 manual (bucket + token) — secrets in Secret Manager; see §3b |
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

### 🔒 Cloudflare dashboard (once per environment)
1. Create the bucket (e.g. `ozari-assets-staging`).
2. Enable **public read** — the bucket's `r2.dev` URL or a **custom domain** (recommended for prod,
   e.g. `https://assets.partyrentalsgt.com`) → this is `R2_PUBLIC_URL`.
3. Create an **R2 API token** scoped to that bucket (Object Read & Write) → copy the **Access Key ID**
   (`R2_ACCESS_KEY`) and **Secret Access Key** (`R2_SECRET_KEY`). The **Account ID** is in the endpoint.
4. Set the bucket's **CORS policy** (bucket → Settings → CORS) — REQUIRED for uploads: the browser
   PUTs to the presigned URL **directly** (a cross-origin request to the S3 endpoint), so without
   this every gallery upload fails preflight. Allow each frontend origin (no trailing slash):

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
| Move the service to a mapping-capable region | free | Native mapping, no proxy at all. **Worth a real look:** Neon lives in `us-east-1`, so `us-east4` would put compute next to the database (DB round trips ~1–5 ms instead of ~60–80 ms) *and* unlock domain mapping. Costs ~30 ms on the single client hop against saving that several times per request. Decide it on its own merits, not mid-cutover. |

> **`trust proxy` / rate limiting.** `app.ts` sets `trust proxy = 1`, and the login + global rate
> limiters key on `req.ip`. Cloudflare inserts one more hop into `X-Forwarded-For` (it forwards the
> client and Google appends the Cloudflare edge, so `trust proxy = 1` should still resolve the real
> client). **Verify after cutover** (§3c.4): if `req.ip` ever resolves to a Cloudflare address, every
> visitor shares one bucket and the limiter throttles the whole app at once. The fix is a
> `keyGenerator` reading `CF-Connecting-IP` — do it only if the check shows it's needed.

> **`trust proxy` / rate limiting.** `app.ts` sets `trust proxy = 1`, and the login + global rate
> limiters key on `req.ip`. Adding Cloudflare inserts one more hop into `X-Forwarded-For`. **Verify
> after cutover** (§3c.4): if `req.ip` ever resolves to a Cloudflare edge address, every visitor
> shares one bucket and the limiter starts throttling the whole app at once. The fix is a
> `keyGenerator` reading `CF-Connecting-IP` — do it only if the check shows it's needed.

### 3c.1 — 🔒 Console steps (Cloudflare)

1. **DNS** → add a record on `partyrentalsgt.com`:
   - Type `CNAME`, Name `api-staging`, Target `ozari-api-694756660984.northamerica-south1.run.app`,
     **Proxy status: Proxied** (orange cloud).
   ⚠️ **One label, with a hyphen.** `api.staging.…` is two levels; Universal SSL covers the apex plus
   ONE, so Cloudflare flags *"this hostname is not covered by a certificate"* and every request dies
   with `SSL alert 40 / handshake_failure` — before it ever reaches the Worker. Covering it would
   mean Advanced Certificate Manager (~US$10/mo). The hyphen form is covered by the existing wildcard
   immediately, with no issuance wait.
2. **Workers & Pages → Create → Workers → Start with Hello World!**
   - Name it `api-staging-proxy` → **Deploy** (the starter deploys first; the editor opens after).
   - **`</> Edit code`** → replace everything with:
     ```js
     export default {
       async fetch(request) {
         const url = new URL(request.url);
         url.hostname = 'ozari-api-694756660984.northamerica-south1.run.app';
         return fetch(new Request(url, request));
       },
     };
     ```
   - **Deploy** again.
   - **Domains → Custom Domains and Routes → Add Route** → zone `partyrentalsgt.com`, pattern
     **`api-staging.partyrentalsgt.com/*`**.
     ⚠️ The field pre-fills `*.partyrentalsgt.com/*` — that would swallow `staging.` too and proxy
     the FRONTEND into the API. Replace it.
     ⚠️ **Route, not Add Domain**: a Custom Domain creates its own DNS record and collides with the
     CNAME above.
   - Once verified, turn OFF the **Worker URL → Production** `…workers.dev` toggle, so the backend
     isn't reachable through a second public address. (Leave it on while debugging — it exercises the
     Worker independently of DNS and TLS.)
3. **SSL/TLS** → *Overview* → encryption mode **Full (strict)** (Cloud Run presents a valid public
   cert). If *Edge Certificates → Always Use HTTPS* interferes with issuance, turn it off until the
   certificate is active, then back on.
4. **R2** → bucket `ozari-assets-staging` → *Settings → CORS* → make `AllowedOrigins` match §3b.4
   (the browser PUTs gallery photos straight to R2 from the app origin — a stale origin here breaks
   every image upload with a preflight failure, while the rest of the app looks fine).
5. **Pages** (project `ozari-c28`) → *Settings → Environment variables* → set
   `VITE_API_URL = https://api-staging.partyrentalsgt.com` → **redeploy** (Vite inlines it at BUILD
   time; an env change alone does nothing until the next build).
6. *(Optional but recommended, now that staging lives on the brand domain)* **Rules → Transform Rules
   → Modify Response Header** → when `Hostname equals staging.partyrentalsgt.com`, *set static*
   `X-Robots-Tag: noindex, nofollow`. `public/robots.txt` ships `Allow: /` for the future marketing
   site, so without this a crawler may index the staging app under your own domain. Header-level, so
   it applies per host without forking the build.

### 3c.2 — 🔒 Console steps (GCP)

7. **Cloud Build** → *Triggers* → `ozari-api-dev` → *Edit* → **Substitution variables** →
   `_APP_HOST = https://staging.partyrentalsgt.com`. *(Terraform owns this trigger — the repo
   default in `variables.tf` now matches, so a later `terraform apply` won't fight it. If you prefer,
   set `app_host` in `terraform.tfvars` and `terraform apply` instead of editing the console.)*
8. **Redeploy the API** (push to `dev`, or re-run the trigger) so Cloud Run picks up the new
   `APP_HOST`. Verify on the service's *Revisions → Variables* tab that `APP_HOST` is the new origin.

> **Do these two in this order with step 5:** while `APP_HOST` still names the old origin, the API
> **rejects** the new frontend with a CORS/API-key failure. If `staging.partyrentalsgt.com` is
> already live and calls are failing, step 6 is the reason.

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

Values before bindings, same as R2 (§3b) and for the same reason: Cloud Run binds `:latest`, and a
binding to a secret with **no version fails the whole deploy** — not just the calendar.

```
1. Create the secret CONTAINERS only (targeted apply — no binding yet, so no version needed).
   In PowerShell, QUOTE each -target or it gets split:
      terraform apply "-target=google_secret_manager_secret.ozari_google_client_id" "-target=google_secret_manager_secret.ozari_google_client_secret"

   If the containers already exist (created by hand), adopt them instead — imports.tf carries an
   import block for each, exactly as ozari-email-key does. Without that, apply fails with a 409.

2. Load the VALUES via gcloud (never in Git):
      "<client id>"     | gcloud secrets versions add ozari-google-client-id --data-file=- --project <project>
      "<client secret>" | gcloud secrets versions add ozari-google-client-secret --data-file=- --project <project>

3. Full apply — creates the run SA's secretAccessor bindings and adds the env to Cloud Run:
      terraform apply       (or scripts/apply-staging.ps1)

4. Redeploy the API so a revision picks the values up (push to the build branch, or re-run the
   trigger). cloudbuild.yaml already carries both in --set-secrets; nothing there needs touching.
```

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
1. Create the prod Neon project (or a prod branch, isolated from staging).
2. Note the **pooled** and **direct** connection strings.
3. Run the role setup as the owner: `psql "<direct-url>" -v db_name=<db> -f infrastructure/scripts/db-roles.sql`.
4. Build the two final connection strings: pooled-as-`ozari_api` (→ `ozari-database-url`) and
   direct-as-owner (→ `ozari-direct-database-url`).

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

### Step 3 — 🔒 Generate the remaining secret values
`ozari-jwt-secret`, `ozari-jwt-refresh-secret` (two distinct random 32+ byte secrets),
`ozari-encryption-key` (exactly 32 bytes hex), `ozari-api-key` (random). Keep them only in your local
gitignored `infrastructure/secrets/prod.env` (mirrors `staging.env`). The two R2 credentials
(`ozari-r2-access-key`/`ozari-r2-secret-key`) and the two Google OAuth values
(`ozari-google-client-id`/`ozari-google-client-secret`) go here too — load them **values-first**
(§3b, §3d) since Cloud Run binds every one of them at `:latest`.

### Step 4 — GCP project + Terraform (infra)
1. Create the prod GCP project; enable billing.
2. Create the prod Terraform env: **copy `infrastructure/terraform/envs/staging/` → `envs/prod/`**,
   then change: `backend.tf` state prefix → `ozari/prod`; `variables.tf` defaults (project id, region,
   `_NODE_ENV=production`, `_APP_HOST=<apex>`, service name, etc.); set the R2 plain values
   (`r2_endpoint`/`r2_bucket_name`/`r2_public_url`) in the prod `terraform.tfvars`; drop `imports.tf`
   (prod is created fresh, not adopted). Everything else mirrors staging (incl. the R2 secret
   containers + IAM + Cloud Run/trigger R2 wiring).
3. Create the state bucket (or reuse with the new prefix): `infrastructure/bootstrap/create-tfstate-bucket.*`.
4. `terraform init && terraform plan` (review) → `terraform apply` (🔒 after human approval). This
   creates: APIs, service accounts, Artifact Registry, **secret containers + IAM**, the Cloud Run
   service shell, and the Cloud Build trigger (pointed at **`main`**).

### Step 5 — 🔒 Load secret values
`infrastructure/scripts/load-secrets-*` (mirror for prod) reads your local `prod.env` and
`gcloud secrets versions add`s each of the 7 secrets. **No values touch git.** The app reads `:latest`.
The R2 pair (§3b) and the Google OAuth pair (§3d) are added the same way (`gcloud secrets versions
add`); **every secret Cloud Run binds needs a version before Step 6**, or the deploy fails.

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
- If the calendar is configured: run the **§3d smoke test** (connect as Admin, check the consent
  screen's permissions, confirm an order's event lands in that calendar), then work through §3d's
  publishing checklist — a Testing-mode app syncs for about a week and then stops.

---

## 6. Cloud Build substitutions & env ownership (the "param replacement")

`cloudbuild.yaml` is parameterised by **substitutions** (`_APP_HOST`, `_API_PUBLIC_URL`, `_NODE_ENV`,
`_IMAGE_URL`, `_REGION`, `_RUN_SA`, `_SERVICE_NAME`, `_MAX_INSTANCES`, `_LOG_LEVEL`, and the
`*_SECRET` names).
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
[ ] 1  Neon prod DB created; db-roles.sql run as owner; pooled(ozari_api)+direct(owner) URLs ready
[ ] 2  Resend prod API key created
[ ] 2b R2 PROD bucket + public read + API token — CORS lists ONLY prod origins, never localhost (§3b)
[ ] 2c Google OAuth client for PROD (§3d): Calendar API on, audience External, scopes
       calendar.events + userinfo.email ONLY, Web-application client, prod redirect URI
       https://api.partyrentalsgt.com/api/calendar/google/callback  ← skip if not shipping calendar
[ ] 3  JWT x2, ENCRYPTION_KEY (32B hex), API_KEY generated into local prod.env (gitignored)
[ ] 4  envs/prod/ Terraform (state prefix ozari/prod, NODE_ENV=production, app_host=FRONTEND origin,
       no imports.tf) → init/plan/apply → containers, SAs, registry, Cloud Run shell, main trigger
[ ] 5  load-secrets (prod) → all 7 secret versions added; then the R2 pair (§3b) and the Google
       OAuth pair (§3d) via gcloud — every bound secret needs a version BEFORE the first deploy
[ ] 6  First build on main → verify/build/migrate/deploy → record the generated run.app URL
[ ] 7  pnpm db:seed once against the fresh prod DB
[ ] 8  DNS: CNAME `api` → the prod run.app host, PROXIED (one label — Universal SSL covers it)
[ ] 8  Worker `api-prod-proxy` (or reuse the pattern) + Route `api.partyrentalsgt.com/*`; disable its
       workers.dev URL afterwards. SSL/TLS = Full (strict)   ← Origin Rules/Snippets are Pro-only
[ ] 8  VERIFY the API on its own host BEFORE touching the frontend: /api/health/check (§3c.4 step 0)
[ ] 9  Cloudflare Pages: custom domain = the prod frontend origin; email-logo.png served
[ ] 9  Pages env VITE_API_URL=https://api.partyrentalsgt.com  → then TRIGGER A REBUILD (inlined!)
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
