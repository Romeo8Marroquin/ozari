# Ozari — Infrastructure-as-Code Plan (the rebuild)

**Goal, in one sentence:** the only handmade inputs to an environment are a local `terraform.tfvars`
and a local secrets file on the developer's machine — everything else is `terraform apply` or a merge
to a branch.

The acceptance test of this document is deliberate and destructive: once testing on the current
staging environment is finished, **staging is torn down and rebuilt from this repo alone**. If
anything cannot be recreated by following §5, that is a gap in this document, not a step to improvise.
Production is then created by the *same* procedure with different inputs — which is the point.

> **Status: PLAN, not yet executed.** Today's staging was adopted, not created (see
> `infrastructure/README.md`). Several things below are still manual. Nothing here is urgent, and
> nothing here should be started before the current staging environment has served its testing
> purpose.

> **Read alongside:** `DEPLOYMENT.md` (the operational runbook — what to click, in what order, and
> the §3b/§3c/§3d console procedures) and `infrastructure/README.md` (how the existing Terraform is
> laid out and operated). This file is the *plan to close the gap between them*.

---

## 1. Principles

1. **If a resource can be declared, it is declared.** Console clicks are for things with no API, or
   whose API cannot be reached without leaking a secret into state.
2. **Secret VALUES never enter Terraform.** Terraform state is plaintext, lives in a GCS bucket, and
   is read by anything that can `terraform plan`. Terraform owns secret *containers* and *IAM*; the
   payloads are pushed by `infrastructure/scripts/load-secrets-*` from a local gitignored file. This
   is not a limitation to work around — it is the boundary.
3. **The public repo carries the SHAPE, never the VALUES.** `*.tfvars.example` and
   `infrastructure/secrets/*.env.example` are committed and complete; the real files are gitignored.
   Anyone cloning the repo can see exactly what an environment needs.
4. **An environment is a directory.** `envs/staging/` and `envs/prod/` differ only in their variable
   values and state prefix. A change that applies to both is made once and copied deliberately, never
   drifted into.
5. **Manual steps are enumerated, not remembered.** §4 is the complete list of what a human must do,
   and it exists so that list can be checked off rather than reconstructed under pressure.

---

## 2. Ownership map — today vs. target

Legend: **TF** = Terraform · **script** = a repo script · **manual** = console/CLI by hand ·
**N/A** = no API exists to automate it.

### 2.1 Google Cloud

| Resource | Today | Target | Notes |
|---|---|---|---|
| Project + billing link | manual | manual | Bootstrapping problem: something must exist before Terraform can authenticate. One-time, ~2 minutes. |
| Service APIs (`run`, `cloudbuild`, `artifactregistry`, `secretmanager`, `iam`) | **TF** (`apis.tf`) | TF | Already declared. Add `cloudscheduler` only if §3.4 is adopted. |
| Service accounts (`ozari-run-sa`, `ozari-build-sa`) | **TF** | TF | Done. |
| Project + secret IAM | **TF** (`iam.tf`) | TF | Additive members only, deliberately. Two hardening TODOs remain (see `iam.tf`). |
| Artifact Registry repo | **TF** | TF | **Add a cleanup policy — §3.1.** |
| Secret Manager containers | **TF** (`secrets.tf`) | TF | Done. Adding a secret = one resource + one `iam.tf` map entry + one `cloud-run.tf` binding + `cloudbuild.yaml`. |
| Secret Manager **versions/values** | script | **script — never TF** | Principle 2. |
| Cloud Build **GitHub connection** | manual | **TF, partially — §3.2** | The connection/repository can be declared; the GitHub App install and its OAuth token cannot. |
| Cloud Build trigger | **TF** (`cloud-build.tf`) | TF | Substitutions are TF-owned; the YAML holds fallbacks. |
| Cloud Run service (structure) | **TF** (`cloud-run.tf`) | TF | Image tag is Cloud Build's (`ignore_changes`). |
| Cloud Run image tag | Cloud Build | Cloud Build | By design. |
| Cleanup job scheduling (`cleanup:sessions`, `purge:evidence`) | manual/never | **TF — §3.4 (optional)** | Cloud Run Job + Scheduler. Cheap, but genuinely optional at this scale. |

### 2.2 Cloudflare

Everything here is manual today and **all of it is declarable** with the Cloudflare provider — this is
the single biggest automation win available (§3.3).

| Resource | Today | Target |
|---|---|---|
| DNS records (`api-staging`, `staging`, apex, Resend's DKIM/SPF) | manual | **TF** |
| Worker script + route (the `Host` rewrite in front of Cloud Run) | manual | **TF** |
| Zone settings (SSL/TLS mode `Full (strict)`) | manual | **TF** |
| Pages project + custom domain | manual | **TF** |
| Pages env var `VITE_API_URL` | manual | **TF** ← removes a documented footgun (it is inlined at build time and silently stale otherwise) |
| R2 bucket | manual | **TF** |
| R2 public access / custom domain | manual | TF *(verify resource support)* |
| R2 **CORS policy** | manual | *verify* — may have no resource; if so it stays manual and MUST stay in §4 |
| R2 API token (access/secret key) | manual | **manual, on purpose** — a TF-created token lands in state (principle 2) |
| Transform Rule (`X-Robots-Tag: noindex` on staging) | manual | **TF** (`cloudflare_ruleset`) |

⚠️ **Provider version trap:** resource names changed between Cloudflare provider v4 and v5
(`cloudflare_record` → `cloudflare_dns_record`, `cloudflare_worker_script` → `cloudflare_workers_script`,
etc.). Pin the version in `versions.tf` and write against *that* version's docs. Do not copy examples
from the internet without checking which major they target.

### 2.3 Neon (PostgreSQL)

| Resource | Today | Target |
|---|---|---|
| Account | manual | manual |
| Project / branch | manual | **TF, community provider** *(evaluate)* |
| Roles (`ozari_api`, owner) + grants | `db-roles.sql`, run by hand | script (keep) |
| Connection strings | manual copy into the secrets file | manual |

There is a **community** Terraform provider for Neon (not HashiCorp-verified). It can manage projects,
branches, databases and roles. Two caveats decide whether it is worth adopting:

1. **Role passwords end up in state.** That collides with principle 2 unless the roles are created by
   `db-roles.sql` and Terraform only manages the project/branch shell.
2. It is one more provider to keep current for two resources that change once a year.

**Recommendation: evaluate, don't assume.** The cheap middle ground is Terraform for the *project and
branch*, `db-roles.sql` for the roles, and the connection strings copied by hand into the secrets file
— which is one manual step, once per environment.

**Free-plan note:** before creating a second Neon *project* for prod, check the plan's project limit.
If it allows only one, a **branch** of the same project gives isolated data at no cost and is a
perfectly good prod/staging split for this workload.

### 2.4 Google Auth Platform (the Calendar OAuth client)

| Resource | Today | Target |
|---|---|---|
| Consent screen / audience / branding | manual | **N/A** |
| Scopes (Data Access) | manual | **N/A** |
| OAuth client + redirect URIs | manual | **N/A** |
| Test users, publishing, verification | manual | **N/A** |

⚠️ **This cannot be automated, and it is worth stating plainly so nobody goes looking again.** The
Terraform Google provider's OAuth resources (`google_iap_brand`, `google_iap_client`) are for
Identity-Aware Proxy only, are restricted to internal/organisation use, and cannot create a general
Web-application client for the Calendar API. The full manual procedure is `DEPLOYMENT.md` §3d and
must stay there.

### 2.5 Resend

| Resource | Today | Target |
|---|---|---|
| Account + domain verification | manual | manual |
| DKIM / SPF / MX DNS records | manual | **TF** (they are Cloudflare DNS records — §3.3) |
| API key | manual | manual (a secret value) |

---

## 3. The work, ranked

### 3.1 Artifact Registry cleanup policy — do this first

**Why first:** it is the cheapest change with the clearest payoff, and it is pure Terraform.

Measured on 2026-09-01: **27 images, 3.8 GB, oldest from June, no retention policy.** Every build
pushes `:latest` + `:$COMMIT_SHA` and nothing is ever deleted. At $0.10/GB/month over a 0.5 GB free
allowance that is ~$0.35–0.42/month of pure history.

Add `cleanup_policies` to `google_artifact_registry_repository` (`artifact-registry.tf`):

- **keep** the N most recent tagged versions (N = 3–5 is plenty — rollback targets, not an archive);
- **delete** untagged versions older than a few days (build leftovers).

Expected result: **~0.5 GB, i.e. free.** Run the policy in `DRY_RUN` first if you want to see what it
would remove before it removes it.

### 3.2 Cloud Build GitHub connection

`google_cloudbuildv2_connection` + `google_cloudbuildv2_repository` can declare the connection and the
linked repo, which removes the hand-wired resource string currently living in
`github_repository_resource`. What stays manual: **installing the GitHub App** on the repository and
creating the OAuth token secret it authenticates with (that token is why
`ozari-github-github-oauthtoken-c19aef` exists in Secret Manager — it is *not* garbage, do not delete
it).

Verdict: worth doing for prod, because it is the one resource whose identifier is otherwise copied by
hand from a console URL.

### 3.3 The Cloudflare provider — the big one

Adding `cloudflare/cloudflare` to the env directories turns the entire §3c cutover procedure — DNS,
the Worker, its route, the SSL mode, the Pages project and, critically, **`VITE_API_URL`** — from a
console checklist into a plan you can read before applying. It also puts Resend's DNS records under
the same roof.

What it needs: a Cloudflare **API token** with the right scopes (Zone:DNS:Edit, Workers Scripts:Edit,
Workers Routes:Edit, Pages:Edit, R2:Edit, Zone Settings:Edit). That token is a secret input to
Terraform — supply it via the `CLOUDFLARE_API_TOKEN` environment variable, **never** a `.tfvars` file.

⚠️ **Adoption, not creation.** The staging zone is live and shared with other projects on the same
Cloudflare account (a landing page, another Worker). Terraform must `import` the records it will own
and **must not** be pointed at resources belonging to anything else. Write the imports explicitly,
plan, and read every line before applying — a careless apply here can take down an unrelated site.

### 3.4 Scheduled cleanup (optional)

`cleanup:sessions` (expired sessions, reset tokens, lapsed auth attempts) and `purge:evidence` are
local scripts run by hand. A `google_cloud_run_v2_job` + `google_cloud_scheduler_job` would run the
first nightly for a few cents a month.

**Honest assessment:** at this scale nothing breaks if it never runs — the tables grow by a few rows a
day and every counter is re-evaluated by time, not by row count. Adopt it when the row counts start
mattering, not before. `purge:evidence` should stay manual regardless: it deletes photos, and a
retention purge is a decision, not a cron.

---

## 4. What a human must always do (the irreducible list)

This is the complete manual surface after all of §3 is adopted. If a step is not on this list and not
in Terraform, that is a bug in this plan.

1. **Create the GCP project**, link billing, and grant yourself owner.
2. **Create the state bucket** (`infrastructure/bootstrap/create-tfstate-bucket.*` — idempotent).
3. **Install the GitHub App** for Cloud Build and create its OAuth token secret.
4. **Create the Neon project/branch**, run `db-roles.sql` as owner, and copy the two connection
   strings into the local secrets file.
5. **Create the Resend API key** (the domain is already verified; its DNS records become Terraform).
6. **Create the Cloudflare R2 API token** (access key + secret key) → the local secrets file.
7. **Create the Google OAuth client** (`DEPLOYMENT.md` §3d): enable the Calendar API, audience
   External, the two scopes, the Web client, the redirect URIs — and later, publishing + verification.
8. **Generate the local secret material**: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`
   (exactly 32 bytes hex — ⚠️ **never rotate this after data exists**), `API_KEY`.
9. **Write `terraform.tfvars`** from the committed `.example`.
10. **Run `load-secrets-<env>`** to push every value as a secret version.
11. **Approve `terraform apply`.**
12. **Run `pnpm db:seed` once** against the fresh database.
13. **Destroy superseded secret versions** after every rotation (§6).

Steps 1–8 are per-environment and one-time. 9–12 are the deploy. 13 is standing hygiene.

---

## 5. Bootstrap order for a NEW environment

The order is not preference — each step unlocks the next, and three of them are genuine
chicken-and-egg problems that are called out where they bite.

```
 1. GCP project + billing                                    (manual)
 2. State bucket                                             (bootstrap script)
 3. envs/<env>/ from envs/staging/: change the state prefix,
    project id, NODE_ENV, hosts, trigger branch; DROP imports.tf
    (a new environment is CREATED, not adopted)              (repo)
 4. terraform init && plan                                   → expect creates only
 5. Targeted apply: APIs + service accounts + IAM +
    Artifact Registry + SECRET CONTAINERS ONLY               (terraform)
      ⚠️ Containers must exist before values, and values before Cloud Run binds
        them at `:latest` — a binding to a secret with no version FAILS THE DEPLOY.
 6. Load secret VALUES                                       (script)
 7. GitHub App install + connection/repository                (manual + terraform)
 8. Full apply: Cloud Build trigger + Cloud Run shell        (terraform)
      ⚠️ APP_HOST must already be the FINAL frontend origin. It is known in
        advance (it is your own domain), so this is not blocked by anything.
 9. First build: push to the trigger branch                  (git)
      → verify → build → migrate deploy → deploy
      → RECORD the generated run.app URL
10. pnpm db:seed, once                                       (script)
11. DNS + Worker + route + SSL mode                          (terraform, after 9:
      the Worker needs the run.app hostname from step 9)
12. Pages project + custom domain + VITE_API_URL             (terraform)
      ⚠️ VITE_API_URL is INLINED AT BUILD TIME. Setting it is not enough —
        the frontend must be rebuilt afterwards.
13. R2 bucket + public access + CORS                         (terraform / manual CORS)
14. Google OAuth client redirect URI for this env's API host (manual, §3d)
15. Smoke tests (§7)
```

**The three chicken-and-eggs, and how each is broken:**

- *The API needs the frontend origin; the frontend needs the API URL.* → `APP_HOST` is your own
  domain and is decided up front (step 8); `VITE_API_URL` is set after the API exists (step 12).
- *The Worker needs the Cloud Run hostname, which only exists after the first deploy.* → DNS/Worker
  come after step 9, not before.
- *Cloud Run cannot start without secret versions, which cannot be loaded before their containers
  exist.* → the split apply at steps 5–8.

---

## 6. Tearing down and rebuilding staging

The rebuild is the proof. Do it **only after** the current environment has finished its testing job.

**Destroy** (`terraform destroy` in `envs/staging/`, plus the manual leftovers):

- Cloud Run service, Cloud Build trigger, Artifact Registry repo (and its images), service accounts,
  secret containers. `terraform destroy` covers these — and this is exactly why
  `infrastructure/README.md` warns that it is dangerous.
- Then, by hand: the Neon project/branch, the R2 bucket, the Cloudflare records/Worker/Pages project,
  and the orphan secrets listed below.

**What is genuinely lost, and who notices:**

| Lost | Consequence |
|---|---|
| Database | All staging orders, products, clients. Intended. |
| R2 objects | Every uploaded product photo and evidence image. Intended — but the DB and the bucket must go **together**, or you get orphans in both directions (`pnpm reconcile:images` is the audit). |
| `ENCRYPTION_KEY` | ⚠️ If the key is regenerated but the database is **kept**, every encrypted column is unreadable **forever**. Destroy both or neither. |
| Google Calendar connections | Every admin must reconnect (refresh tokens are in the dropped DB). Events already written to their calendars **stay** and become orphans — delete them by hand if they are noise. |
| ICS feed URLs | Every subscribed device silently stops updating. Re-generate and re-subscribe on each device. |
| Sessions | Everyone is logged out. |

**Cleanups to fold into the rebuild** (measured 2026-09-01 — these are the cost items from §8):

- Delete the orphan secrets `jwt-secret`, `neon-database-url`, `neon-direct-url` — early-setup
  leftovers superseded by the `ozari-*` names, referenced by nothing in `cloudbuild.yaml` or
  Terraform. **Verify that claim before deleting** (`gcloud secrets versions access latest` to see
  what each holds, and grep the repo).
- Destroy the superseded versions of `ozari-jwt-secret` (3 enabled) and `ozari-jwt-refresh-secret`
  (2 enabled), keeping only the newest of each.
- **Keep** `ozari-github-github-oauthtoken-c19aef` — it is Cloud Build's GitHub connection token.
- Scope down the two over-privileged bindings noted in `iam.tf` (default compute SA with
  `roles/editor`; the Cloud Build service agent with `roles/secretmanager.admin`).

---

## 7. Verification after any rebuild

```
[ ] terraform plan is CLEAN (no drift) immediately after apply
[ ] GET /api/health/check → healthy
[ ] /api/docs served on staging, ABSENT on production (NODE_ENV gate)
[ ] register → login → forgot-password (email arrives) → reset → login
[ ] a product photo upload succeeds        (proves R2 credentials AND CORS)
[ ] an order can be created, advanced, paid, and its PDF opens
[ ] iPhone: log in, wait >15 min, still logged in   (proves first-party cookies, §3c.4)
[ ] Calendar: connect Google, an order's events appear in the ASSIGNEE's calendar only
[ ] pnpm reconcile:images reports CLEAN
[ ] Cost: Artifact Registry back under 0.5 GB after the first few builds
```

---

## 8. Cost model (measured, 2026-09-01)

| Service | Now | After §3.1 + §6 cleanups |
|---|---|---|
| Secret Manager | $1.08 (18 enabled versions × $0.06) | **$0.72** (12 legitimate versions) |
| Artifact Registry | ~$0.42 (3.8 GB / 27 images) | **~$0.00** (cleanup policy → under the 0.5 GB free tier) |
| Cloud Build | $0.00 | $0.00 (2,500 free build-minutes/month) |
| Cloud Run | $0.00 | $0.00 (scale-to-zero + free tier) |
| **Staging total** | **~$1.57/mo** | **~$0.75/mo** |
| **Staging + production** | — | **~$1.40/mo** |

**Both environments together should cost roughly what staging alone costs today.** The marginal cost
of production is its own ~11 secret versions; Cloud Run and Cloud Build stay inside the free tier, and
the registry stays free once the cleanup policy exists.

Two structural notes that keep it there:

- **Free tiers are per BILLING ACCOUNT, not per project.** A separate prod project buys isolation, not
  extra allowance.
- **Promote the image, don't rebuild it.** Deploying the *same* artifact from staging to production
  halves registry storage and build minutes — and is better release practice, since you ship exactly
  what you tested. Worth deciding before prod exists (§9).

**Standing hygiene:** Secret Manager bills **every enabled version, forever**. After any rotation,
destroy the version it replaced. That single habit is what keeps this bill flat.

**Do not chase further savings.** Packing all secrets into one blob would save ~$7/year and cost a
boot-time parse plus a new failure mode in the deploy path. Moving clouds is worse: AWS Secrets
Manager charges **$0.40 per secret per month** — the same 11 secrets would be ~$4.40. GCP with
scale-to-zero is already the cheap answer.

---

## 9. Decisions to make before executing

These are open on purpose. Each changes the shape of `envs/prod/`, so decide them *before* writing it.

1. **Separate GCP project for prod, or one project with two services?** Separate is the
   recommendation in `DEPLOYMENT.md` (hard isolation, no shared blast radius); it costs nothing extra
   but doubles the Terraform directories to maintain.
2. **One shared Artifact Registry with image promotion, or one per environment?** Promotion is
   cheaper and better practice; it requires the prod pipeline to *deploy an existing tag* rather than
   build from source, which is a real change to `cloudbuild.yaml`.
3. **Neon: second project, or a branch of the first?** Decided by the free plan's project limit.
4. **Neon under Terraform at all?** (§2.3 — community provider, passwords in state.)
5. **Cloudflare under Terraform now or at prod time?** Adoption of a live, shared zone is the risky
   part; doing it during the staging rebuild is safer than during a production cutover.
6. **Does staging survive the rebuild permanently, or is it torn down and recreated per test cycle?**
   At ~$0.66/month it is cheap enough to keep standing.
