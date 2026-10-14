# Ozari — Infrastructure Plan & Decision Record

**Goal, in one sentence:** an environment is built from one gitignored directory of values on the
owner's machine plus a short, enumerated list of clicks that no API can replace. Everything else is a
reviewed `terraform apply`, a script, or a push to a branch. It runs at the lowest cost that stays
stable, and its bill grows linearly with use, with no jump to a paid tier.

**Read alongside:** `REBUILD.md` (the ordered procedure: build, retire, verify) ·
`infrastructure/README.md` (how to run the scripts and Terraform) · `DEPLOYMENT.md` (ongoing
releases, rotation, rollback). This file is the plan and the decision record: what is automated, what
cannot be, and why.

---

## 0. Execution plan — the October 2026 rebuild

### 0.1 Status

| Phase | State |
|---|---|
| 1 — Code & docs rework | ✅ **done 2026-10-09**, merged to `dev` 2026-10-13 (PRs #42–#44) |
| 2 — Credentials (Group A of `REBUILD.md` §3) | ✅ **done 2026-10-12** (`account.ps1`: every check passed) |
| 3 — Build the new staging (`REBUILD.md` §4) | ✅ **done 2026-10-13**: `ozari-staging-gt` #27754621719, Neon `ozari-staging`, all three stacks applied, first deploy + seed + Pages build, end-to-end verified. Fixed on the way (now in code): Cloud Run's bootstrap image, the trigger SA's connection access, an IAM 409 race, the visitor IP behind the Worker (`trust proxy 2`). Rotation drilled (INCIDENTS.md §4). Registration switch added; staging registration **closed** after its admins were promoted. |
| 4 — Retire the pre-rebuild staging | ✅ **done 2026-10-12** as step 3 of phase 3 (`retire.ps1 legacy-staging`): Worker + route, Pages `ozari` (132 deployments), bucket `ozari-staging` (23 objects), 2 CNAMEs, Neon `ozari`, project `ozari-500103` (undeletable until ~2026-11-11). Resend key carried over. Email DNS verified intact. Left: the old R2 token, deleted at Group B. |
| 5 — Production (same procedure, `prod` inputs) | ⏭️ next (planned 2026-10-14). Create `main` from `dev` first. |
| 6 — Handover: off-machine backup of `infrastructure/secrets/`, first-month cost review | 🔄 backup ✅ (1Password: `account.json`, `staging.json`; add `prod.json`); cost review after the first month (staging measured ≈ US$0.40/month) |

### 0.2 Decisions (owner, 2026-10-09)

| # | Decision | Why |
|---|---|---|
| D1 | **Both environments get brand-new GCP projects** (`ozari-staging-gt`, `ozari-prod-gt`), created by the same bootstrap. The pre-rebuild `ozari-500103` (and its Neon project and Cloudflare objects) is deleted at the **start** of the staging build, by `retire.ps1 legacy-staging`. Its data is disposable (owner, 2026-10-12), and it holds the hostnames the new staging needs. | The only way to guarantee no leftovers: orphan secrets, a console-made GitHub connection, a default compute SA holding Editor, and a state bucket holding *every* environment's state inside the disposable project. |
| D2 | **Each project holds its own state** (bootstrap included; it migrates its state into the bucket it creates). | Deleting staging can never take production's state with it. |
| D3 | **Region: Cloud Run `us-east4` + Neon `aws-us-east-1` + R2 hint `enam`.** | Users are in Guatemala, but each API request runs several database queries **one after another**. In the same metro (N. Virginia) a query takes ~1–2 ms; across the border it took ~40 ms, paid on every query. The extra distance from Guatemala to Virginia is paid once per request, at the Cloudflare edge. Neon has no region in Mexico, and its Azure regions are deprecated. **Price is identical**: `us-east4` and `northamerica-south1` are both Cloud Run Tier 1 (verified 2026-10-09). |
| D4 | **Production hostnames:** app at the apex `partyrentalsgt.com`, API at `api.`, assets at `assets.`. Staging: `staging.`, `api-staging.`, `assets-stg.` (unchanged, so the frontend CSP needs no edit). | Owner confirmed the apex is free. |
| D5 | **Staging first, then production**, identical procedure, different inputs. Prod deploys from a new `main` branch. | A mistake in the procedure shows up first on the environment we can throw away. |
| D6 | **Every value lives in `infrastructure/secrets/`** (gitignored): `account.json` + one file per environment, filled by scripts and hidden prompts. | One directory = the recovery set. Values reach tools only as process environment variables, never as provider arguments, so never in state. |
| D7 | **Keep staging permanently**, and keep staging + production at ~$1–1.50/month combined (§8). | The owner's ceiling is ~$5/month total. Both fit with room to spare, and a place to rehearse a production change is worth more than the difference. |
| D8 | **Neon stays** as the database. | Free plan: 100 projects, 100 CU-hours and 1 GB **per project**. Overages *suspend*, they never bill. The paid plan (Launch) is purely usage-based with **no monthly minimum** ($0.106/CU-hour, $0.35/GB-month), so growth costs linearly, with no fixed-price jump. |
| D9 | **Three database logins** (owner, 2026-10-12): `neondb_owner` = the DBA (pgAdmin; URL never stored), `ozari_migrator` = owns the schema for Prisma migrations and the seed (no server powers), `ozari_api` = DML only for the running API. | A leaked pipeline secret reaches one schema, not the server; a compromised API cannot change the schema. The full who-can-do-what table is `DEPLOYMENT.md` §3. |

---

## 1. Principles

1. **If a resource can be declared, it is declared.** Console clicks are for things with no API.
2. **Secret values never enter Terraform *state*.** Terraform ≥ 1.11 *write-only* arguments
   (`secret_data_wo`) send a value to the API and keep nothing, in state or in a saved plan. That
   exposure equals piping the value to `gcloud`, so Terraform owns the values, and rotation destroys
   the superseded version in the same apply.
3. **The public repo carries the SHAPE, never the VALUES.** `infrastructure/templates/` lists every
   key; `infrastructure/secrets/` (gitignored) holds every value. Account ids live there too: they
   are not secrets, but nothing in a public repo needs them.
4. **An environment is a module call, not a copied directory.** `envs/<env>/` holds inputs only, and
   a change that applies to both environments is made once, in `modules/`.
5. **Built fresh, never adopted.** Every environment is created from nothing in its own project. No
   import blocks, no `moved` blocks, no "adopt the live thing" mode.
6. **Manual steps are enumerated, not remembered.** `REBUILD.md` §3 is the complete list.
7. **Blast radius follows credentials.** Three roots per environment (bootstrap, cloudflare, gcp),
   separate states. A Cloud Run change cannot reach DNS, and an edge change cannot reach the
   database.
8. **What you review is what you apply.** `tf.ps1` plans to a file and applies that file.

---

## 2. The automation map

Legend: **TF** Terraform · **script** a repo script · **manual** a human, because no API exists ·
**never** possible but deliberately not done.

### 2.1 Google Cloud

| Resource | Owner | Note |
|---|---|---|
| Project + billing link | **TF** (`envs/<env>/bootstrap`) | `deletion_policy = PREVENT`; no default VPC network. Needs `roles/billing.user` on the billing account. |
| State bucket | **TF** (bootstrap) | Versioned, uniform access, public access prevented. The first run applies locally and `tf.ps1` migrates the state into the bucket. No pre-Terraform script remains. |
| Service APIs | **TF** | Includes `calendar-json` (the OAuth client lives in the project). `disable_on_destroy = false`. |
| Service accounts (run, build, scheduler) | **TF** | |
| Project + secret IAM | **TF** | Additive members only. The default compute SA's Editor grant is removed surgically (`iam_member_remove`), never with an authoritative binding. |
| Cloud Build service agent | **TF** | `google_project_service_identity`. It used to be a "run this gcloud command and re-apply" step. |
| Artifact Registry + **cleanup policy** | **TF** | Keep N newest, delete untagged after 7 days, delete stale tagged. Durations in **seconds**. |
| Secret Manager containers **and values** | **TF (write-only)** | One registry map (`modules/gcp-env/secrets.tf`). Counter bump = rotation. |
| Cloud Run service | **TF** | Structure only; Cloud Build owns the image tag (`ignore_changes`). |
| Runtime env contract | **TF** | `_SET_ENV_VARS` / `_SET_SECRETS` computed once, forwarded by `cloudbuild.yaml`. |
| Cloud Build GitHub connection + repo link + trigger | **TF** | The connection authenticates with a classic PAT held in Secret Manager. |
| GitHub App install, classic PAT | **manual** | No API mints either. |
| Scheduled `cleanup:sessions` | **TF**, opt-in | Cloud Run Job + Scheduler, `enable_cleanup_job`. Off by default: every counter is re-evaluated by time. |
| `purge:evidence` | **never** | It deletes photographs of finished work. A retention purge is a decision, not a cron. |

### 2.2 Cloudflare

| Resource | Owner | Note |
|---|---|---|
| DNS (app, api) | **TF** | Both **proxied**. A grey-clouded API record bypasses the Worker and Google answers 404. The app record targets the project's *real* `pages.dev` host (it may carry a random suffix). |
| Worker + version + deployment + route | **TF** | Targets Cloud Run's **deterministic** hostname, so the edge can exist before the service. workers.dev subdomain off. A route, not a Workers Custom Domain (which would collide with the CNAME). |
| Zone settings (SSL strict, Always HTTPS) | **TF**, production root only | Zone-wide, so exactly one root owns them. |
| Pages project, **Git-connected**, build config, `VITE_API_URL` | **TF** | Previews **off** (two projects share one repo, so previews would double the builds) and watch path `ozari-app/*`. `VITE_API_URL` takes effect at the next build (`pages-build.ps1`). |
| Pages custom domain | **TF** | |
| R2 bucket + CORS + custom domain | **TF** | The custom domain creates its own DNS record. |
| `X-Robots-Tag: noindex` on staging | **TF** | Response-header transform rule. |
| Pages ↔ GitHub account authorisation | **manual**, once per account | Already done on this account. |
| R2 API token | **never** TF | A TF-created token writes its secret into state. Minted per environment, bucket-scoped. |
| Terraform's own Cloudflare API token | **manual** | Stored in `account.json`, given to Terraform as `CLOUDFLARE_API_TOKEN`. |

### 2.3 Neon (PostgreSQL)

| Resource | Owner | Note |
|---|---|---|
| Account, organization API key | manual | `account.ps1` detects the org and proves the key. |
| Project (region, Postgres 18, 0.25–1 CU autoscaling, scale-to-zero) | **script** (`neon.ps1` → Neon CLI) | Settings in `environment.json`. |
| `ozari_migrator` (owns the schema) + `ozari_api` (DML only) + grants | **script** (`db-bootstrap.mjs`, SQL as the owner) | `DEPLOYMENT.md` §3 has the table of who can do what. |
| Proof that both roles hold only what their job needs | **script** | Runs on every `neon.ps1`; fails the script before any URL is saved. Tested against real Postgres 18. |
| Connection strings | **script** | The migrator's (direct) and the app's (pooled) go straight into the secrets file, never printed. **The owner/DBA URL is never stored**: fetched in memory for each run. |

**Why not the Neon Terraform provider** (community-maintained): ⚠️ any role created through Neon's
Console, API, CLI or that provider is automatically granted `neon_superuser` (CREATEDB, CREATEROLE,
full DDL). The provider therefore *cannot express* the role this application needs. A role that can
drop your tables looks normal, and everything keeps working, so nothing would tell you. The
**project** has no such problem, so the CLI creates it. The **role** is SQL.

### 2.4 Google Auth Platform (the Calendar OAuth client) — **manual, permanently**

Consent screen, audience, scopes, client, redirect URIs, publishing, verification. The provider's
OAuth resources (`google_iap_*`) are Identity-Aware-Proxy-only and cannot create a Web-application
client. The procedure is `DEPLOYMENT.md` §3d, once per environment, **in that environment's
project**.

### 2.5 Resend

Account + domain verification: manual, already done. API key: manual, one per environment. The
DKIM/SPF/MX records already on the zone are left alone (see `REBUILD.md` §1).

---

## 3. The configuration map

| # | File | In git? | Holds |
|---|---|---|---|
| 1 | `infrastructure/terraform/envs/<env>/environment.json` | **committed** | project id/name, region, state bucket, Neon project/region/version/CU |
| 2 | `infrastructure/terraform/envs/<env>/*/variables.tf` | **committed** | the environment's non-secret shape: hostnames, names, sizes, branch |
| 3 | `infrastructure/secrets/account.json` | **gitignored** | billing account, GitHub App installation id, Cloudflare account/zone id + API token, Neon API key |
| 4 | `infrastructure/secrets/<env>.json` | **gitignored** | the 12 secret values + rotation counters |
| 5 | `ozari-api/.env` | **gitignored** | local development only (`REBUILD.md` §7) |
| 6 | `gcloud auth application-default login` | n/a | the Google credential; nothing stored by us |

**The 12 secret values** (template: `infrastructure/templates/env.example.json`):

| Key | Source |
|---|---|
| `database_url`, `direct_database_url` | `neon.ps1` |
| `jwt_secret`, `jwt_refresh_secret`, `api_key` | `new-secrets.ps1` |
| `encryption_key` | `new-secrets.ps1`. ⚠️ 32 bytes hex, **never rotated once data exists** |
| `email_key` | Resend (one per environment) |
| `r2_access_key`, `r2_secret_key` | Cloudflare R2 token, bucket-scoped |
| `google_client_id`, `google_client_secret` | Google Auth Platform, in the environment's project |
| `github_oauth_token` | GitHub **classic** PAT, `repo` + `read:user` |

⚠️ **Every value differs between staging and production.** A shared `jwt_secret` means a staging token
authenticates against production. A shared `encryption_key` means a staging dump decrypts production
PII.

---

## 4. What a human must always do

The operational list, with where every value goes, is **`REBUILD.md` §3**. In summary: once per
account, a billing account, the Cloud Build GitHub App install, Cloudflare ids + API token, a Neon
API key. Once per environment, a GitHub classic PAT, a Resend key, an R2 token, the OAuth client
(and for production, publishing + verifying it). Then approve each reviewed `apply`.

**Previously manual, now code:** project creation and billing link, the state bucket (no
pre-Terraform script remains), the Neon project, the database URLs, the Cloud Build service agent,
the Calendar API enablement, the Pages ↔ repo connection, the Pages first build, the R2 public
domain, the run.app hostname hand-off to the Worker, and destroying superseded secret versions.

---

## 5. Layout

See `infrastructure/README.md` → Layout. In short: `modules/{bootstrap,gcp-env,cloudflare-env}`,
and `envs/<env>/{environment.json,bootstrap,cloudflare,gcp}`. Each environment's state lives in its
own project's bucket under `ozari/bootstrap`, `ozari/cloudflare` and `ozari/gcp`.

---

## 6. Order of a new environment, and why

`bootstrap` → Neon → generated secrets → `cloudflare` → R2 token, OAuth client, Resend key, PAT →
`gcp` → first build → seed → first Pages build. (`REBUILD.md` §4 has the commands.)

**The chicken-and-eggs, and what happened to each:**

- ~~*The Worker needs the Cloud Run URL, which exists only after the first deploy.*~~ **Gone.** The
  deterministic hostname `ozari-api-<project_number>.<region>.run.app` is computed from the bootstrap
  state, so the edge is built first.
- ~~*The gcp root needs the R2 token; the R2 bucket was created after it.*~~ **Gone.** Cloudflare is
  applied before GCP.
- ~~*Cloud Run needs secret versions before their containers exist.*~~ **Gone.** One graph, one apply.
- ~~*The Cloud Build service agent appears lazily.*~~ **Gone.** `google_project_service_identity`.
- *The API needs the frontend origin; the frontend needs the API URL.* **Still real, still trivial:**
  both are our own hostnames, decided in code up front.

---

## 7. Verification

`REBUILD.md` §6. The two gates that matter most: `neon.ps1 <env> -VerifyOnly` passes, and both
`plan`s are empty right after an apply.

---

## 8. Cost model — and how it grows

**Today, both environments: about $1–1.50/month in total.**

| Service | Free allowance (per BILLING ACCOUNT unless noted) | Ozari use | Cost now | Past the allowance (linear) |
|---|---|---|---|---|
| Secret Manager | 6 active versions | 24 (12 × 2 envs) | **~$1.08** | $0.06 per version-month |
| Cloud Run (request-based, scale-to-zero) | 180k vCPU-s, 360k GiB-s, 2M requests / month | far below | $0 | per vCPU-s / GiB-s / request |
| Cloud Build | 2,500 build-minutes / month | ~5 min per deploy | $0 | per build-minute |
| Artifact Registry | 0.5 GB | 2–3 images per env, pruned automatically | $0 | $0.10 / GB-month |
| Cloud Storage (state) | — | kilobytes | ~$0 | per GB-month |
| Cloud Scheduler (if `enable_cleanup_job`) | 3 jobs | 0–2 | $0 | $0.10 / job-month |
| Neon | **per PROJECT**: 100 CU-hours, 1 GB, 5 GB egress | small, scales to zero after 5 min idle | $0 | Launch plan: **no minimum**, $0.106 / CU-hour, $0.35 / GB-month |
| Cloudflare Pages | 500 builds / month, unlimited static traffic | previews off, watch path → only real frontend changes build | $0 | — |
| Cloudflare Workers | 100,000 requests / **day** | every API call is one request | $0 | ⚠️ the one **step**: Workers Paid is $5/month flat (10M requests included) |
| Cloudflare R2 | 10 GB, 1M writes, 10M reads / month; **egress always free** | photos | $0 | $0.015 / GB-month |
| DNS, SSL | free | | $0 | — |

**Growth is linear everywhere except one place, and that place is far away.** The Worker's free
100k requests/day is roughly 3M API calls a month, which a single rental business is unlikely to
approach. If it ever does, the move is to Workers Paid ($5/month flat), or to the Cloud Run domain
mapping that `us-east4` supports (free, but Google labels it preview). Neon's paid plan has no
minimum: the first paid month after outgrowing the free plan costs cents, not a tier price.

**Spend controls already in the code:** Cloud Run `max_instances` (staging 2, prod 3) caps how much
a traffic spike can cost; scale-to-zero means idle costs $0; the registry cleanup policy stops
the only resource that grew with every deploy; rotation destroys superseded secret versions; Neon
autoscaling is capped at 1 CU.

**A HARD cap per environment (owner, 2026-10-14):** `monthly_budget_usd` (US$5 each, so at most
~US$10/month for both) in `envs/<env>/gcp/variables.tf`. A Cloud Billing budget scoped to the
project emails at 50 / 90 / 100 % and publishes to Pub/Sub; at 100 % a small function
(`modules/gcp-env/spend-cap.tf`) unlinks the project's billing, which stops every Google service in
it — an outage instead of an open-ended bill. Its identity holds only Project Billing Manager on its
own project (Google's sample grants Billing Account Administrator; that is not needed for the unlink
and is not granted). Costs: nothing measurable (a few invocations a day, free tiers). Limits: cost
data arrives hours late, so the cap can be overshot by that window's spend. Recovery: INCIDENTS.md
S12. Every other provider's limit (Neon, Resend, Workers, Pages: hard stops on their free plans; R2:
no stop exists, an account budget alert instead) and how to change each: `DEPLOYMENT.md` §12.

**Do not chase further savings.** Packing all secrets into one blob saves ~$0.90/month and adds a
boot-time parse and a new failure mode to the deploy path.

---

## 9. Decisions — resolved, do not re-open without new facts

1. **Separate GCP project per environment?** ✅ Yes. Free tiers are per billing account, so isolation
   costs nothing.
2. **Registry per environment, building from source** (not image promotion). ✅ A registry that
   production depends on cannot live in a project we may delete. If true promotion is ever wanted:
   a `cloudbuild-promote.yaml` that re-tags a digest, plus a cross-project
   `artifactregistry.reader`. Additive, not a rewrite.
3. **Neon: a project per environment, not a branch.** ✅ Quotas are per project.
4. **Neon under Terraform?** ✅ No (§2.3). The project is a CLI call, the role is SQL.
5. **Worker vs Cloud Run domain mapping vs load balancer?** ✅ Worker: $0. The domain mapping is
   preview everywhere, and a global load balancer is ~$18/month.
6. **Region** ✅ `us-east4` / Neon `aws-us-east-1` (D3).
7. **Keep staging?** ✅ Yes (D7).

---

## 10. Known risks — what the first real run will prove

Nothing in Phase 1 has touched a cloud. `terraform validate` passes on all six roots against the
real provider schemas (Terraform 1.16.5, google/google-beta 8.6.0, cloudflare 5.27.0). The secrets
tooling was exercised end to end on throwaway data. What only a real run proves:

1. **Project ids are global.** `ozari-staging-gt` / `ozari-prod-gt` may be taken. The fix is to edit
   `environment.json` (`REBUILD.md` §8).
2. **Billing-account project limit.** New billing accounts sometimes allow only a few linked
   projects. During the transition there are three (old staging, new staging, prod).
3. **Postgres 18 under Prisma 7.** It is a supported version, but the first `migrate deploy` on
   staging is the real proof. If it fails, set `pg_version` to 17 in `environment.json` and recreate
   the Neon project. That is what staging is for.
4. **Pages build image settings.** The old project may have had hand-set build variables (for
   example `PNPM_VERSION`). `cf-inventory.ps1` prints them before the old project is deleted, and
   they go into `pages_build_env`.
5. **Write-only secret versions cannot detect drift.** A version added by hand with `gcloud` is
   invisible to Terraform. The counter records intent.
6. **The classic PAT expires.** Deploys stop silently when it does. Set a reminder at mint time.
