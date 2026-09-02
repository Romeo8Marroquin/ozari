# Ozari — Infrastructure as Code

**Goal, in one sentence:** the only handmade inputs to an environment are two gitignored files on a
developer's machine and a short list of clicks that no API can replace — everything else is
`terraform apply` or a merge to a branch.

> **Status (2026-09-01): the code is written and validated; nothing has been applied.**
> `terraform validate` passes on all four roots against the real provider schemas. The staging
> environment is untouched and still running the pre-rework configuration. §7 is the procedure for
> adopting the rework; §8 is the teardown-and-rebuild.

**Read alongside:** `DEPLOYMENT.md` (the operational runbook — what to click, in what order) and
`infrastructure/README.md` (how the Terraform is laid out and operated day to day). This file is the
plan and the decision record: what is automated, what cannot be, and why.

---

## 1. Principles

1. **If a resource can be declared, it is declared.** Console clicks are for things with no API.
2. **Secret values never enter Terraform *state*.** ⚠️ **This principle was revised on 2026-09-01
   and the change is deliberate.** It used to read "secret values never enter Terraform", which was
   correct when it was written: state is plaintext, lives in a bucket, and is readable by anything
   that can run `plan`. Terraform 1.11 added **write-only arguments** — `secret_data_wo` accepts a
   value, sends it to the API, and never persists it to state or to a saved plan. The exposure is
   now identical to piping the value to `gcloud`, so the reason to keep a separate secret-loading
   script disappeared, and with it a two-phase apply, a forgettable bootstrap step and a standing
   manual chore (destroying superseded versions, which Secret Manager bills for forever).
3. **The public repo carries the SHAPE, never the VALUES.** Every `*.example` file is committed and
   complete; the real file beside it is gitignored. Anyone cloning the repo can see exactly what an
   environment needs and hold none of it.
4. **An environment is a module call, not a copied directory.** `envs/staging/` and `envs/prod/`
   contain inputs only. A change that applies to both is made once, in `modules/`. (Before this
   rework an environment *was* a directory of resources, and production would have been created by
   copy-paste — the mechanism by which two environments quietly stop being the same thing.)
5. **Manual steps are enumerated, not remembered.** §4 is the complete list, and it exists so it can
   be checked off rather than reconstructed under pressure.
6. **Blast radius follows credentials.** GCP and Cloudflare are separate Terraform roots with
   separate states. A Cloud Run change cannot reach DNS, and an edge change cannot reach the
   database.

---

## 2. The automation map

Legend: **TF** Terraform · **script** a repo script · **manual** a human, because no API exists ·
**never** possible but deliberately not done, with the reason.

### 2.1 Google Cloud — fully automated except two GitHub clicks

| Resource | Owner | Note |
|---|---|---|
| Project + billing link | **TF** (`terraform/bootstrap`) | `google_project` with `billing_account`. Was on the manual list; it has an API. Needs `roles/billing.user` on the billing account, or the project is created UNLINKED and every later step fails with a billing error that names neither cause. |
| Terraform state bucket | **TF** (`terraform/bootstrap`) + one script | Versioned, uniform access, public-access-prevented. The *first* bucket is a script (`bootstrap/create-tfstate-bucket.*`) — something has to hold the state of the thing that creates state buckets. |
| Service APIs | **TF** | `disable_on_destroy = false`, so a destroy never turns an API off project-wide. |
| Service accounts (run, build, scheduler) | **TF** | |
| Project + secret IAM | **TF** | Additive members. The build SA's `serviceAccountUser` on the run SA is now declared — it was granted out-of-band before, which is why a from-scratch environment would have failed its first deploy. |
| Artifact Registry repo | **TF** | |
| **Registry cleanup policy** | **TF** | New. Keep N recent + delete untagged + delete stale tagged. Durations must be in **seconds** — the provider rejects `7d` (#20796). |
| Secret Manager containers | **TF** | One registry map (`modules/gcp-env/secrets.tf`) drives containers, versions, IAM, the Cloud Run binding and the Cloud Build `--set-secrets`. Adding a secret is one entry. |
| **Secret Manager versions/values** | **TF (write-only)** | New — see principle 2. `ephemeral` variable → `secret_data_wo`. Rotation is a counter bump; the superseded version is destroyed in the same apply. |
| Cloud Run service | **TF** | Structure only; the image tag stays Cloud Build's (`ignore_changes`). |
| Cloud Run image tag | Cloud Build | By design. |
| **Runtime env contract** | **TF** | New. `_SET_ENV_VARS` / `_SET_SECRETS` are computed by Terraform and forwarded by `cloudbuild.yaml`. The two used to keep separate copies of one list, and `--set-env-vars` replaces rather than merges — so adding a variable to one silently wiped it from the service on the other's next run. |
| Cloud Build trigger | **TF** | |
| **Cloud Build GitHub connection + repo link** | **TF** | New. `google_cloudbuildv2_connection` + `_repository`. |
| GitHub App install + PAT | **manual** | Two clicks and a token, once per GitHub account. No API creates either. |
| Scheduled `cleanup:sessions` | **TF**, opt-in | Cloud Run Job + Scheduler, `enable_cleanup_job`. Off by default and that is honest, not neglect: every counter is re-evaluated by time, not row count. |
| `purge:evidence` | **never** | It deletes photographs of completed work. A retention purge is a decision, not a cron. |

### 2.2 Cloudflare — was entirely manual, now entirely declared

Every row here was a console click before this rework. Verified against provider **v5** (validated
locally, not assumed — the resource names and the block-vs-attribute syntax both changed from v4).

| Resource | Owner | Note |
|---|---|---|
| DNS records (api, app, Resend DKIM/SPF/MX) | **TF** | `cloudflare_dns_record`. Both app records must be **proxied** — a grey-clouded API record bypasses the Worker entirely and Google answers 404. |
| Worker script + version + deployment | **TF** | `cloudflare_worker` + `_worker_version` + `_workers_deployment`. The old single `cloudflare_workers_script` is **deprecated**. The script is a real `.js` file templated with the Cloud Run hostname. |
| Worker route | **TF** | A **route**, not a Workers Custom Domain — a custom domain creates its own DNS record and collides with the CNAME. |
| workers.dev subdomain | **TF** | Turned **off**: it is a second public address for the API that bypasses the zone's protections. |
| Zone settings (SSL `strict`, Always Use HTTPS) | **TF** | ⚠️ Zone-wide, so exactly ONE environment may own them (`manage_zone_settings`). |
| Pages project + build config | **TF** | |
| **Pages `VITE_API_URL`** | **TF** | The highest-value single row here. Vite inlines it at BUILD time, so as a console field it was invisible, unversioned and silently stale. It still requires a rebuild to take effect — Terraform setting it is necessary, not sufficient. |
| Pages custom domain | **TF** | `cloudflare_pages_domain`; it does not create the DNS record, `dns.tf` does. |
| Pages ↔ GitHub connection | **manual** (opt-in TF after) | A one-time OAuth authorization in the dashboard. `manage_pages_source` can declare it afterwards. |
| R2 bucket | **TF** | |
| **R2 CORS policy** | **TF** | The old plan recorded this as "may have no resource; if so it stays manual". It has one: `cloudflare_r2_bucket_cors`. |
| R2 custom domain | **TF** | |
| Transform rule (`X-Robots-Tag` on staging) | **TF** | `cloudflare_ruleset`, response-headers phase. |
| R2 API token (access/secret key) | **never** | A Terraform-created token writes its secret into state. Minted in the dashboard, on purpose. |
| Cloudflare API token for Terraform | **manual** | The credential Terraform authenticates with cannot be created by Terraform. Supplied as `CLOUDFLARE_API_TOKEN`, never a tfvars value. |

### 2.3 Neon (PostgreSQL) — automatable, and deliberately not automated

**Verdict: script, not provider — and this is a correctness decision, not a preference.**

| Resource | Owner | Note |
|---|---|---|
| Account | manual | |
| Project / branch | manual | One click, once per environment. |
| **App role + grants** | **script** (`db-bootstrap.*` + `db-roles.sql`) | See below. |
| Verification that the role is least-privileged | **script** (`db-verify.sql`) | New. Exits non-zero if the role can do DDL. |
| Connection strings | manual copy into the gitignored secrets file | |

There **is** a Terraform provider (`kislerdm/neon`, community, sponsored but explicitly not supported
by Neon), and it can create projects, branches, databases and roles. It is not adopted, for two
reasons — the first of which is decisive:

1. ⚠️ **A role created through the Neon Console, API, CLI or that provider is automatically granted
   `neon_superuser`**, which carries CREATEDB, CREATEROLE and full DDL. The provider therefore
   *cannot express* the role this application needs. A least-privileged app role can only be created
   with SQL, by the owner. Automating it with the provider would silently produce a role that can
   drop your tables — and everything would keep working, so nothing would tell you.
2. Role passwords are computed, sensitive attributes: they land in state, which collides with
   principle 2 for a resource that changes about once a year.

**Free-plan answer (checked 2026-09-01, the old note said "verify this"):** the Neon free plan allows
**100 projects**, 10 branches per project, and — the part that decides it — **100 CU-hours and 0.5 GB
of storage *per project*, per month**. So production gets its **own Neon project**, not a branch:
isolation is free, and a staging load test cannot eat production's compute allowance.

**The database concern you raised is real and this is where it is answered.** `db-roles.sql` existed
before this rework but was never verifiably applied, and the app may well be connecting as the owner
today. That means the running API can `DROP TABLE`. `scripts/db-bootstrap.*` now creates or rotates
the role, and `db-verify.sql` **proves** the result: no superuser, no CREATEDB/CREATEROLE, no group
memberships (this is the check that catches `neon_superuser`), no CREATE on the schema, owns no
tables, and full DML plus default privileges for future migrations. **Run the verify against staging
before anything else in this plan** — it takes ten seconds and answers the question directly.

### 2.4 Google Auth Platform (the Calendar OAuth client) — **N/A, permanently**

| Resource | Owner |
|---|---|
| Consent screen, audience, branding, scopes, OAuth client, redirect URIs, test users, publishing, verification | **manual** |

⚠️ **This cannot be automated by any tool, and it is worth stating plainly so nobody goes looking
again.** The Terraform Google provider's OAuth resources (`google_iap_brand`, `google_iap_client`)
are Identity-Aware Proxy only, are restricted to internal/organisation use, and cannot create a
general Web-application client for the Calendar API. The full manual procedure is `DEPLOYMENT.md`
§3d and must stay there.

### 2.5 Resend

| Resource | Owner |
|---|---|
| Account + domain verification | manual |
| DKIM / SPF / MX records | **TF** (they are Cloudflare DNS records — `extra_dns_records`) |
| API key | manual (a secret value, minted in their dashboard) |

---

## 3. The configuration map — every file you create, per environment

This answers "what do I have to set, and where, for local vs staging vs prod". **Every file in the
"gitignored" column has a committed `.example` beside it.** Nothing with a real value is ever in git.

| # | File | Env | In git? | Holds |
|---|---|---|---|---|
| 1 | `ozari-api/.env` | local only | **gitignored** | The whole local runtime: `DATABASE_URL`, `DIRECT_DATABASE_URL`, `SHADOW_DATABASE_URL`, JWT/encryption/API keys, `EMAIL_KEY`, `R2_*`, `GOOGLE_CLIENT_*`, `APP_HOST=http://localhost:5173`, `API_PUBLIC_URL=` (empty — no proxy in front locally). Deployed environments never read a `.env`. |
| 2 | `ozari-app/.env` | local only | **gitignored** | `VITE_API_URL` — and locally it is not even needed, because Vite proxies `/api` to `localhost:3000`. |
| 3 | `infrastructure/terraform/bootstrap/terraform.tfvars` | prod (once) | **gitignored** | `project_id`, `billing_account`, `state_bucket_name`. |
| 4 | `infrastructure/terraform/envs/<env>/gcp/terraform.tfvars` | staging, prod | **gitignored** | Non-secret but account-identifying: `r2_endpoint`, `r2_bucket_name`, `r2_public_url`, `github_app_installation_id`, and for prod `project_id` + `project_number`. |
| 5 | `infrastructure/terraform/envs/<env>/gcp/secrets.auto.tfvars` | staging, prod | **gitignored** | **All 11 secret values** + the rotation counters. Auto-loaded by Terraform, so no flag is needed. |
| 6 | `infrastructure/terraform/envs/<env>/cloudflare/terraform.tfvars` | staging, prod | **gitignored** | `cloudflare_account_id`, `cloudflare_zone_id`, the Pages project name, the R2 bucket name, Resend's DNS records. |
| 7 | `CLOUDFLARE_API_TOKEN` | staging, prod | **environment variable — never a file** | The Cloudflare credential. A token passed as a provider argument is written into state. |
| 8 | `gcloud auth application-default login` | all | n/a | The Google credential. Nothing to store. |

**The 11 secret values, and where each comes from:**

| Key | Source |
|---|---|
| `database_url` | `scripts/db-bootstrap.*` prints it (pooled, least-privileged role) |
| `direct_database_url` | Neon dashboard (the owner URL) |
| `jwt_secret`, `jwt_refresh_secret`, `api_key` | `scripts/new-secrets.ps1` |
| `encryption_key` | `scripts/new-secrets.ps1`. ⚠️ **32 bytes hex, and never rotated once data exists** — every `*_kms` column becomes permanently unreadable. Regenerating it is the same decision as discarding the database. |
| `email_key` | Resend dashboard |
| `r2_access_key`, `r2_secret_key` | Cloudflare R2 API token (dashboard — a TF-created token would land in state) |
| `google_client_id`, `google_client_secret` | Google Auth Platform (`DEPLOYMENT.md` §3d). May be empty strings; the keys must still be present. |

⚠️ **Every value must differ between staging and production.** A shared `jwt_secret` means a staging
token authenticates against production; a shared `encryption_key` means a staging database dump
decrypts production PII.

---

## 4. What a human must always do (the irreducible list)

After everything above, this is the complete manual surface. If a step is not on this list and not in
Terraform, that is a bug in this plan.

👉 **[`REBUILD.md`](./REBUILD.md) §3 is the operational version of this list** — the same steps in
dependency order, each with what it produces and exactly which file the value goes into. Use that one
when actually doing it; this one is the inventory.

1. **Have a Google account and a billing account** with a payment method. (Everything downstream is
   `terraform/bootstrap`.)
2. **Create the first Terraform state bucket** — `infrastructure/bootstrap/create-tfstate-bucket.*`.
   Only ever once, for the account.
3. **Install the Cloud Build GitHub App** on the repository and **mint a GitHub PAT** (REPO_ADMIN
   scope) for the connection to authenticate with.
4. **Create the Neon project**, then run `scripts/db-bootstrap.*` (which is not manual — the manual
   part is only the click that creates the project).
5. **Create the Resend API key.**
6. **Create the Cloudflare R2 API token** and the **Cloudflare API token for Terraform**.
7. **Authorize Cloudflare Pages against GitHub** (a one-time OAuth click per account).
8. **Create the Google OAuth client** (`DEPLOYMENT.md` §3d) — and later, publish + verify it.
9. **Generate the local secret material** (`scripts/new-secrets.ps1`) and write the two gitignored
   tfvars files from their examples.
10. **Approve `terraform apply`.**
11. **Run `pnpm db:seed` once** against the fresh database.

Steps 1–9 are per-environment and one-time. 10–11 are the deploy. **Previously on this list and now
automated:** creating the project, linking billing, creating the state bucket, loading every secret
value, destroying superseded secret versions, and the entire Cloudflare console procedure.

---

## 5. Layout

```
infrastructure/
  bootstrap/                       one-time state-bucket script (the only pre-Terraform step)
  scripts/
    tf.ps1                         plan/apply for any env+stack, with preflight checks
    new-secrets.ps1                generates JWT / encryption / API key material
    db-bootstrap.ps1 | .sh         creates or rotates the least-privileged DB role
    db-roles.sql                   the grants
    db-verify.sql                  PROVES the role cannot do DDL (exits non-zero if it can)
  terraform/
    bootstrap/                     creates a new GCP project + its state bucket   (state: ozari/bootstrap)
    modules/
      gcp-env/                     every Google Cloud resource an environment needs
      cloudflare-env/              DNS, Worker, Pages, R2, zone settings
    envs/
      staging/gcp/                 inputs only                                    (state: ozari/staging)
      staging/cloudflare/          inputs only                        (state: ozari/staging-cloudflare)
      prod/gcp/                    inputs only                                       (state: ozari/prod)
      prod/cloudflare/             inputs only                            (state: ozari/prod-cloudflare)
```

**Why GCP and Cloudflare are separate roots.** Different credentials (Google ADC vs a Cloudflare
token) and different blast radius: the zone is live and shared with other projects, so an apply there
can take an unrelated site offline, while an apply next door cannot reach the zone at all. The one
value that crosses — the `run.app` hostname the Worker proxies to — is read from the GCP root's state
via `terraform_remote_state`, which is what dissolves the old runbook step *"deploy first, then copy
the generated URL into the Worker by hand"*.

---

## 6. Bootstrap order for a NEW environment

Each step unlocks the next. **Two of the three old chicken-and-egg problems are now solved by the
code and no longer appear here.**

```
 1. terraform/bootstrap: project + billing + state bucket        (terraform)
      → record project_id and project_number from the outputs
 2. Neon: create the project (click), then:
      scripts/db-bootstrap.ps1 -DirectUrl "<owner url>"          (script)
      → prints the pooled, least-privileged DATABASE_URL
 3. GitHub App install + PAT; Cloudflare Pages GitHub authorization  (manual)
 4. Mint: Resend key, R2 token, Cloudflare API token, Google OAuth client  (manual)
 5. scripts/new-secrets.ps1                                       (script)
 6. Write envs/<env>/gcp/{terraform,secrets.auto}.tfvars from the examples
 7. tf.ps1 <env> gcp apply                                        (terraform)
      Secrets, IAM, registry, trigger and the service in ONE pass. The old two-phase
      apply is gone: the service depends_on the secret VERSIONS, so Terraform orders it.
 8. Push to the trigger branch                                    (git)
      → verify → build → migrate deploy → deploy
 9. pnpm db:seed, once                                            (script)
10. Write envs/<env>/cloudflare/terraform.tfvars; export CLOUDFLARE_API_TOKEN
11. tf.ps1 <env> cloudflare apply                                 (terraform)
      DNS, Worker, route, Pages, R2, CORS. The Worker gets the run.app hostname from
      the gcp root's state — nothing is copied by hand.
12. Rebuild the frontend                                          (Pages redeploy)
      ⚠️ VITE_API_URL is INLINED AT BUILD TIME. Terraform setting it changes nothing
        until the next build.
13. Add this environment's redirect URI to the Google OAuth client (manual, §3d)
14. Smoke tests (§9)
```

**The chicken-and-eggs, and what happened to each:**

- ~~*The Worker needs the Cloud Run hostname, which only exists after the first deploy.*~~ **Solved.**
  It is a module output read through remote state.
- ~~*Cloud Run cannot start without secret versions, which cannot exist before their containers.*~~
  **Solved.** One graph, one apply.
- *The API needs the frontend origin; the frontend needs the API URL.* **Still real, still trivial:**
  both hostnames are your own domain and are decided up front. `APP_HOST` is set at step 7,
  `VITE_API_URL` at step 11.

---

## 7. Getting from here to there

**The chosen path is a full rebuild** (owner decision, 2026-09-01): staging is erased and recreated
from this repository once the current testing round finishes. Production is then created by the same
procedure with different inputs, which is the point of the whole exercise.

👉 **The procedure is [`REBUILD.md`](./REBUILD.md)** — the ownership register (what is ours to destroy
and what belongs to the unrelated `qa-ulew` landing page), the complete ordered list of manual steps,
the teardown, the rebuild sequence and the verification.

The adoption path below is kept as a fallback, for the case where the rebuild has to wait and a fix
is needed sooner.

**Path A — adopt in place (no downtime).** The state prefix is unchanged and `envs/staging/gcp/moved.tf`
maps every old resource address into the module, so Terraform sees moves rather than destroys.

```
1. Run db-verify.sql against staging FIRST — it is read-only and answers the DB question.
2. Delete the stale provider cache: infrastructure/terraform/envs/staging/.terraform
3. Write secrets.auto.tfvars with the CURRENT values (read them back with
   `gcloud secrets versions access latest --secret=ozari-...` — you need them anyway).
4. tf.ps1 staging gcp plan
```

⚠️ **Read that plan carefully. Expect:** ~25 moves, in-place updates on the registry (cleanup
policies), the service (labels) and the trigger (substitutions), and **11 new
`google_secret_manager_secret_version` creates**. That last group is the one to understand: Terraform
does not know the current values (write-only arguments leave no trace), so it adds one new version
per secret with the values you supplied. That is harmless — the app reads `:latest` — but it bills
until you destroy the superseded ones. **Expect ZERO destroys of the service, the registry, the
service accounts or any secret container.** If you see one, stop.

**Path B — rebuild.** The chosen path. See [`REBUILD.md`](./REBUILD.md).

---

## 8. What the rebuild cleans up

Fold these into the rebuild rather than doing them separately (measured 2026-09-01):

- The orphan secrets `jwt-secret`, `neon-database-url`, `neon-direct-url` — early-setup leftovers
  superseded by the `ozari-*` names, referenced by nothing. ~$0.18/month of nothing. **Verify before
  deleting** (`gcloud secrets versions access latest`, and grep the repo).
- The superseded versions of `ozari-jwt-secret` (3 enabled) and `ozari-jwt-refresh-secret` (2
  enabled). After this rework, rotation destroys them automatically.
- `ozari-github-github-oauthtoken-c19aef` — the console-created connection's token. It goes with the
  connection; the rebuild creates a new secret (`ozari-github-oauth-token`) that Terraform owns.
- Set `revoke_default_compute_sa_editor = true`. A freshly-built environment has nothing legitimately
  holding `roles/editor`, so the authoritative binding is safe there in a way it is not on a project
  with history.
- Set `manage_github_connection = true` on staging — the reason it is `false` today (a live 2nd-gen
  connection perma-diffs on import) stops applying the moment the connection is created from scratch.

The list of what is **irrecoverably lost** in the teardown — and it includes one item with no recovery
path at all, `ENCRYPTION_KEY` — is `REBUILD.md` §2. Read it before destroying anything.

---

## 9. Verification after any apply or rebuild

```
[ ] db-verify.sql PASSES  (no superuser, no group memberships, no CREATE, owns no tables)
[ ] terraform plan is CLEAN immediately after apply, on both stacks
[ ] GET https://api-<env>.partyrentalsgt.com/api/health/check answers from OUR API
      (200 with x-api-key, or 403 — a 403 means Express received it. A Google-styled 404
       means the Host rewrite did not happen: the route or the proxy status is wrong.)
[ ] /api/docs served on staging, ABSENT on production (the NODE_ENV gate)
[ ] register → login → forgot-password (email arrives) → reset → login
[ ] a product photo upload succeeds        (proves R2 credentials AND the CORS origin)
[ ] an order can be created, advanced, paid, and its PDF opens
[ ] iPhone: log in, wait >15 min, still logged in   (proves first-party cookies)
[ ] Calendar: connect Google; an order's events appear in the ASSIGNEE's calendar only
[ ] pnpm reconcile:images reports CLEAN
[ ] req.ip resolves to the real client, not a Cloudflare edge address (DEPLOYMENT.md §3c)
[ ] Artifact Registry back under 0.5 GB after a few builds
```

---

## 10. Cost model

| Service | Before | After |
|---|---|---|
| Secret Manager | $1.08 (18 enabled versions) | **$0.66** (11 versions, and rotation now destroys the old one) |
| Artifact Registry | ~$0.42 (3.8 GB / 27 images) | **~$0.00** (cleanup policy → under the 0.5 GB free tier) |
| Cloud Build | $0.00 | $0.00 (2,500 free build-minutes/month) |
| Cloud Run | $0.00 | $0.00 (scale-to-zero + free tier) |
| Cloudflare (Workers, Pages, R2, DNS) | $0.00 | $0.00 (free tiers) |
| Neon | $0.00 | $0.00 (free plan, per-project quotas) |
| **Per environment** | ~$1.50/mo | **~$0.66/mo** |
| **Staging + production** | — | **~$1.32/mo** |

Two structural notes that keep it there:

- **Free tiers are per BILLING ACCOUNT, not per project.** A separate production project buys
  isolation, not extra allowance — but it costs nothing either.
- **Artifact Registry was the whole problem**, and a cleanup policy is the whole fix. It grows with
  every deploy, forever, and nothing else here does.

**Standing hygiene is now automatic:** Secret Manager bills every *enabled* version. Rotation through
Terraform replaces the version resource and destroys the superseded one in the same apply, which is
the habit that used to have to be remembered.

**Do not chase further savings.** Packing all secrets into one blob saves ~$7/year and buys a
boot-time parse plus a new failure mode in the deploy path. Moving clouds is worse: AWS Secrets
Manager charges $0.40 per secret per month — the same 11 secrets would be ~$4.40.

---

## 11. Decisions — resolved

The old §9 listed six open questions. All are now answered; recorded here so they are not re-opened.

1. **Separate GCP project for prod?** ✅ **Yes.** Free-tier allowances are per billing account, so
   isolation is free. Same billing account, same structure, its own project.
2. **Shared registry with image promotion, or one per environment?** ✅ **One per environment,
   building from source.** Promotion is better release practice in general, but here staging is
   explicitly disposable — a registry that production depends on cannot live in a project you plan
   to destroy, and hosting it in the production project to work around that inverts the dependency.
   The cost argument dissolved once cleanup policies existed: two pruned registries are ~0 GB.
   Production still ships what was tested, because `main` is merged from `dev` and the build is
   deterministic. **If you later want true promotion**, the change is a second, smaller
   `cloudbuild-promote.yaml` that re-tags a digest, plus a cross-project `artifactregistry.reader`
   binding — additive, not a rewrite.
3. **Neon: second project or a branch?** ✅ **A second project.** The free plan allows 100, and
   quotas are per project, so staging cannot consume production's compute hours.
4. **Neon under Terraform?** ✅ **No** — the provider cannot express a least-privileged role (§2.3).
5. **Cloudflare under Terraform now or at prod time?** ✅ **Now**, as its own root. Adopting a live
   shared zone is the risky part, and doing it during a staging rebuild is far safer than during a
   production cutover.
6. **Does staging survive permanently?** ✅ **Yes** — at ~$0.66/month it is cheap enough to keep
   standing, and having somewhere to rehearse a production change is worth more than that.

---

## 12. Known risks, and what to check on the first plan

Honest list of what this rework has *not* proved, since nothing has been applied.

1. **Cloudflare objects that survive a teardown block the rebuild.** The zone is shared with one
   unrelated project (`qa-ulew`), but that is a *don't-touch* list rather than a hazard — the
   register is `REBUILD.md` §1, and inventory commands are there too. The real failure mode is
   duller: an object the destroy missed makes the next apply fail with "already exists". Delete it in
   the dashboard and re-apply; do not reach for `terraform import` mid-rebuild.
   ⚠️ The one genuinely zone-wide setting is SSL mode / Always-Use-HTTPS (`manage_zone_settings`),
   which applies to every hostname on the domain including the landing page's.
2. **`manage_pages_source` is off.** After the rebuild the Pages project is created by Terraform, but
   its GitHub *connection* still needs the one-time account authorization (`REBUILD.md` §3, A5)
   before that flag can be turned on.
3. **The Cloud Build GitHub connection is `manage_github_connection = false` on staging** because
   importing a live 2nd-gen connection is known to perma-diff on `app_installation_id`. It flips to
   `true` on the rebuild, and is `true` from the start on production — at which point Terraform also
   owns the PAT secret it authenticates with.
4. **Write-only secret versions cannot detect drift.** If someone adds a version with `gcloud`,
   Terraform will not notice and will not correct it. That is the trade for values never touching
   state; the counter in `secret_version_triggers` is the record of intent.
5. **`google_project_iam_binding` for `roles/editor` is authoritative.** Read the live policy before
   enabling `revoke_default_compute_sa_editor`.
6. **Cloud Run domain mapping is not an escape hatch.** Verified 2026-09-01: still unavailable in
   `northamerica-south1`, and Google now documents mappings as *"not production-ready and not
   supported at General Availability"* **everywhere**. The Worker is not a workaround for a missing
   region; it is the correct answer.
