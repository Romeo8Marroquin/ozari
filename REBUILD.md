# Ozari — Teardown & Rebuild Runbook

**What this is:** the procedure for erasing a deployed environment and rebuilding it from this
repository, plus **the complete, ordered list of everything a human must do by hand** — the steps no
API can perform, with where each value goes.

**When to run it:** after the current testing round finishes. **Not before.** Nothing in this file is
urgent, and every step is reversible only in the sense that you can do it again from scratch.

> **Why the rebuild is the preferred path, not the fallback.** Staging holds no data anyone needs and
> production does not exist yet, so this is the last moment where "delete it and do it properly" is
> free. A rebuild starts with none of what adoption leaves behind: a database role nobody can prove
> is least-privileged, secret versions Terraform did not create, a Cloud Build connection referenced
> by a hand-copied resource string.
>
> **Until then, staging is live and must be treated that way.** Any change made before the rebuild
> window goes through the ADOPTION path — `INFRASTRUCTURE-PLAN.md` §7 — which imports what exists
> before changing anything. Two scripts do the discovery (`gcp-import.ps1`, `cf-import.ps1`), and the
> rule for reading the resulting plan is short: **no destroys, and no new secret versions.** Never
> point this Terraform at the live environment without importing first; the failure mode is not a
> refusal, it is a silent secret rotation to whatever your tfvars happens to contain.

**Read first:** `INFRASTRUCTURE-PLAN.md` (what is automated and why) · `DEPLOYMENT.md` (ongoing
operations) · `infrastructure/README.md` (how to run Terraform).

---

## 1. The ownership register — what is ours, and what must never be touched

Everything Ozari owns can be destroyed. Two categories are **not** destroyable, for different reasons.

### ⚠️ Never destroyed, because Terraform was never given them

| Asset | Why it is outside Terraform |
|---|---|
| **The domain `partyrentalsgt.com`** — its registration, renewal and transfer | A purchased, account-level asset. There is **no `cloudflare_zone` and no registrar resource anywhere in this repo**, and none may be added. The guarantee comes from the absence of a resource, not from being careful. |
| **The Cloudflare zone itself** | Same. Terraform manages the **records inside** the zone and the services they point at — nothing above that line. |
| **The GitHub repository** | Never referenced as a managed resource. |
| **The Google account, the billing account, the Cloudflare account** | Same category as the domain. |

A `terraform destroy` on the Cloudflare root removes DNS *records*, a Worker, a Pages project and a
bucket. It cannot remove, transfer, disable or fail to renew the domain, because the domain was never
handed to it.

### ⚠️ Never touched, because it belongs to someone else

| ❌ NEVER TOUCH | Where it lives |
|---|---|
| **`qa-ulew`** — an unrelated landing page | Cloudflare: its own Pages project, its DNS records, any Worker or route it uses |

| ✅ OURS — destroy freely | Where |
|---|---|
| Cloud Run service, jobs, revisions | GCP `ozari-500103` |
| Artifact Registry `ozari-images` + every image | GCP |
| Cloud Build trigger, connection, build history | GCP |
| Secret Manager: every `ozari-*` secret and version | GCP |
| Service accounts `ozari-run-sa`, `ozari-build-sa` | GCP |
| Neon project (database, branches, roles) | Neon |
| R2 bucket `ozari-assets-staging` + all objects | Cloudflare |
| Pages project `ozari-c28` | Cloudflare |
| Worker `api-staging-proxy` + its route | Cloudflare |
| DNS: `api-staging.partyrentalsgt.com`, `staging.partyrentalsgt.com` | Cloudflare |
| Google OAuth client + consent screen (Calendar) | Google Auth Platform |
| Cloud Build GitHub App installation | GitHub |
| Cloudflare Pages ↔ GitHub authorization | GitHub |

**The repository itself is never touched.** And to be precise about "GitHub pipelines": **this repo
has no GitHub Actions workflows** (verified — `.github/` contains none, and `CLAUDE.md` forbids
adding deploy workflows). What exists on GitHub is two *app authorizations*, listed above. Removing
them removes nothing from the codebase.

### Verify the register — and adopt what already exists

One command does both. It is read-only against Cloudflare and writes one local file:

```powershell
$env:CLOUDFLARE_API_TOKEN = "<token>"
./infrastructure/scripts/cf-import.ps1 -Environment staging
```

It prints an inventory of every DNS record, Worker, route, Pages project, R2 bucket and ruleset on
the account, each marked **OURS** or **not ours — leave alone**, and writes
`imports.generated.tf` containing import blocks **for the OURS rows only**. Nothing belonging to
`qa-ulew` is ever written into an import block. Use `-InventoryOnly` to look without writing.

**Why importing matters even when you intend to destroy.** Pointing Terraform at a live zone without
importing makes every existing object look like something to *create*, and the apply fails with
"already exists" — the conflict, not a rebuild. After the import, `terraform plan` shows the genuine
differences between what is live and what this repo declares; **if they already match, the plan is
empty and the objects are simply now managed.** That is the "just connect this" case.

⚠️ **Three things cannot or need not be imported, and the generated file explains each:**

| | Why | What Terraform does instead |
|---|---|---|
| `cloudflare_r2_bucket_cors` | The provider supports no import for it | **Creates** it. Safe — the CORS API is a full replace, so applying our policy over the existing one is the intended outcome. |
| `cloudflare_worker_version` / `_workers_deployment` | Worker versions are immutable by design | Uploads the script from this repo as a **new version** and points traffic at it. Correct: afterwards the deployed Worker is the one in git. |
| `cloudflare_zone_setting` | Settings always exist; there is nothing to discover | Imported by `<zone_id>/<setting_id>`, which the script emits, so the first apply is a diff rather than a blind write. |

⚠️ **One shared setting genuinely affects `qa-ulew`:** the zone's SSL mode and Always-Use-HTTPS are
**zone-wide**, not per-hostname. `manage_zone_settings` is what declares them. Setting SSL to
`strict` requires every origin on the zone — including the landing page's — to present a valid
certificate. Pages origins do, so this is safe in practice; it is called out because it is the only
line in the Cloudflare config whose blast radius is larger than the hostnames it names.

---

## 2. What is irrecoverably lost

| Lost | Consequence |
|---|---|
| Database | All staging orders, products, clients. Intended. |
| R2 objects | Every product photo and evidence image. ⚠️ The DB and the bucket must go **together**, or you get orphans in both directions (`pnpm reconcile:images` is the audit). |
| `ENCRYPTION_KEY` | ⚠️ If the key is regenerated but a database is **kept**, every `*_kms` column is unreadable **forever**. Destroy both or neither — never one. |
| Google Calendar connections | Every admin reconnects. Events already written to their calendars **stay** and become orphans; delete them by hand if they are noise. |
| ICS feed URLs | Every subscribed device silently stops updating. Re-generate and re-subscribe per device. |
| Sessions | Everyone is logged out. |
| Build history and logs | Cloud Build history goes with the trigger. Nothing depends on it. |

---

## 3. The manual steps — the complete list, in dependency order

These are the only things no API can do. Everything else in this repo is `terraform apply`.

Each row says what it produces and **exactly where that value goes**. `secrets.auto.tfvars` and
`terraform.tfvars` are per-environment and gitignored; `INFRASTRUCTURE-PLAN.md` §3 is the full
file-by-file map.

### Group A — accounts and credentials (before any Terraform)

| # | Step | Produces | Goes to |
|---|---|---|---|
| A1 | Google Cloud account + a **billing account** with a payment method | — | — |
| A2 | *(new environment only)* run `infrastructure/bootstrap/create-tfstate-bucket.*` once per account | the first state bucket | already referenced by the backend blocks |
| A3 | **Install the Cloud Build GitHub App** on the repository — github.com → Settings → Applications → Google Cloud Build → Configure | the **installation id** (the number in that page's URL) | `envs/<env>/gcp/terraform.tfvars` → `github_app_installation_id` |
| A4 | **Create a GitHub PAT** with REPO_ADMIN scope (fine-grained, limited to this repo, with an expiry you will notice) | the token | `envs/<env>/gcp/secrets.auto.tfvars` → `github_oauth_token` |
| A5 | **Authorize Cloudflare Pages against GitHub**, and **connect the project to the repo** — Cloudflare → Workers & Pages → the project → Settings → Builds & deployments → Connect to Git. ⚠️ Two different things: the account-level OAuth authorization, and the per-project repository link. Terraform can create a Pages project, but **a project with no Git source never builds** — it exists and serves nothing. For a NEW environment, do this immediately after the Cloudflare apply, or set `manage_pages_source = true` once the account authorization exists | a connected, buildable project | nothing to copy |
| A6 | **Create a Cloudflare API token** (Custom Token) with: Zone → DNS:Edit, Zone Settings:Edit, Workers Routes:Edit; Account → Workers Scripts:Edit, Cloudflare Pages:Edit, Workers R2 Storage:Edit | the token | ⚠️ the **`CLOUDFLARE_API_TOKEN` environment variable**, never a file — as a provider argument it would be written into state |
| A7 | Note the Cloudflare **account id** and **zone id** (dashboard → any zone → Overview → API) | two ids | `envs/<env>/cloudflare/terraform.tfvars` |

### Group B — third-party resources

| # | Step | Produces | Goes to |
|---|---|---|---|
| B1 | **Create the Neon project.** One per environment, not a branch — the free plan allows 100 projects and quotas (100 CU-hours, 0.5 GB) are *per project*, so staging cannot eat production's allowance | the **owner (direct)** connection string | `secrets.auto.tfvars` → `direct_database_url` |
| B2 | **Create an R2 API token** scoped to this environment's bucket, Object Read & Write. (The bucket, its CORS and its custom domain are Terraform — only the token is manual, because a Terraform-created token writes its secret into state) | Access Key ID + Secret Access Key, and the **account id** inside the endpoint | `secrets.auto.tfvars` → `r2_access_key`, `r2_secret_key`; endpoint → `terraform.tfvars` → `r2_endpoint` |
| B3 | **Create a Resend API key** — one per environment, so revoking a leaked staging key never stops customer email. The domain `partyrentalsgt.com` is already verified | the key | `secrets.auto.tfvars` → `email_key` |
| B4 | **Create the Google OAuth client** — `DEPLOYMENT.md` §3d has the full procedure: enable the Calendar API, audience **External**, scopes `calendar.events` + `userinfo.email` ONLY, a Web-application client, and this environment's redirect URI | client id + client secret | `secrets.auto.tfvars` → `google_client_id`, `google_client_secret` |
| B5 | *(later, production only)* **Publish the OAuth consent screen** and complete Google's verification | — | ⚠️ An app left in Testing expires refresh tokens after ~7 days, which presents as calendars silently going stale a week after launch |

⚠️ **B4 is permanently manual and worth stating so nobody re-opens it.** The Terraform Google
provider's OAuth resources (`google_iap_brand`, `google_iap_client`) are Identity-Aware Proxy only,
are restricted to internal/organisation use, and cannot create a general Web-application client.

### Group C — generated locally (scripts, not clicks — listed so nothing is missed)

| # | Step | Produces | Goes to |
|---|---|---|---|
| C1 | `./infrastructure/scripts/new-secrets.ps1` | `jwt_secret`, `jwt_refresh_secret`, `encryption_key`, `api_key` | `secrets.auto.tfvars` |
| C2 | `./infrastructure/scripts/db-bootstrap.ps1 -DirectUrl "<B1 owner url>"` | the pooled, least-privileged `database_url` — and it **proves** the role cannot do DDL before printing it | `secrets.auto.tfvars` → `database_url` |

⚠️ **`encryption_key` is generated once and never rotated** while an environment holds data. Back it
up somewhere outside the machine that generated it. Rotating it is the same decision as discarding
the database.

⚠️ **Every value must differ between staging and production.** A shared `jwt_secret` means a staging
token authenticates against production; a shared `encryption_key` means a staging dump decrypts
production PII.

---

## 4. The database role — deferred on purpose, and the rebuild is when it gets fixed

**Do not patch this on the live staging environment.** Rotating the application's database credential
under a running service means the next cold start picks up a role whose grants have just changed —
and if anything is missing (a sequence, a table created by a migration the default privileges did not
cover), the failure surfaces as a permission error on a table that plainly exists, in production-like
conditions, for no benefit.

**The rebuild removes the problem instead of fixing it.** On a fresh Neon project, `db-bootstrap`
runs *before* the app has ever connected: the owner creates the schema through `prisma migrate
deploy`, the app role is created with DML-only grants plus default privileges for future migrations,
and `db-verify.sql` gates the whole thing. There is no live traffic and no credential to swap.

Until then, staging keeps whatever role it has. If you want to know what that is — read-only, safe to
run right now, changes nothing:

```powershell
psql "$DIRECT_DATABASE_URL" -v app_role=ozari_api -f infrastructure/scripts/db-verify.sql
```

A `FAIL` on the group-membership check means the role is a member of `neon_superuser` and can do DDL
— the specific failure mode that made this worth flagging, because such a role behaves perfectly
normally right up until something injects a statement it should never have been able to run.

---

## 5. Teardown

Destroy in this order. The dependency runs Cloudflare → GCP because the Cloudflare root reads the
GCP state.

```powershell
# 1. Edge first — its Worker targets a Cloud Run host that is about to stop existing.
cd infrastructure/terraform/envs/staging/cloudflare
terraform destroy          # REVIEW the plan against §1's register before confirming

# 2. Then Google Cloud.
cd ../gcp
terraform destroy
```

⚠️ **There is no `destroy` verb in `tf.ps1`, deliberately.** Running it means typing the command
yourself, in the right directory, having read the plan. That friction is the point.

`terraform destroy` covers: the Cloud Run service and jobs, Artifact Registry and its images, the
build trigger and connection, every secret container **and version**, the service accounts, IAM, and
on the Cloudflare side the DNS records, Worker, route, Pages project, R2 bucket and zone rules.

**Then, by hand:**

| # | Action | Note |
|---|---|---|
| T1 | Delete the **Neon project** | Takes the database, its branches and every role with it |
| T2 | Delete the orphan secrets `jwt-secret`, `neon-database-url`, `neon-direct-url` | Early-setup leftovers superseded by the `ozari-*` names. ⚠️ **Verify first** — `gcloud secrets versions access latest --secret=<name>` and grep the repo — then delete. They are ~$0.18/month of nothing. |
| T3 | Delete the **Google OAuth client** and its consent screen | Or keep it and just add the new redirect URI later; it is the one item where reuse is genuinely simpler |
| T4 | Uninstall the **Cloud Build GitHub App**, or leave it installed and reuse the installation id | Reusing is fine and saves step A3 |
| T5 | Revoke the **GitHub PAT** and the **Cloudflare API token** if they are not being reused | |
| T6 | Tell admins their **calendar events are orphans** | Events already written stay in their calendars; nothing will ever update or remove them |

**What is NOT destroyed and should not be:** the GCP project itself (staging reuses
`ozari-500103`), the Terraform state bucket, the GitHub repository, **the domain and its Cloudflare
zone**, the Resend domain verification, and anything belonging to `qa-ulew`.

**Destroying the Cloudflare side is optional.** Its only real cost is DNS downtime while records are
recreated, and its only real benefit is that Terraform creates rather than adopts. Skipping it is
legitimate — run `cf-import.ps1` and let Terraform adopt what is there. Do not skip it *and* forget
the import; that is the "already exists" collision.

---

## 6. Rebuild

Manual steps from §3 are marked 🔒; everything else is code.

```
 1. 🔒 A3, A4  GitHub App installation id + PAT
 2. 🔒 A6, A7  Cloudflare API token (as an env var), account id, zone id
 3. 🔒 B1      Create the Neon project → the owner direct URL
 4.    C2      db-bootstrap → the pooled least-privileged URL, verified
                 (the role now exists before a single migration has run)
 5. 🔒 B2, B3, B4   R2 token · Resend key · Google OAuth client
 6.    C1      new-secrets → jwt x2, encryption_key, api_key
 7.            Write envs/staging/gcp/{terraform,secrets.auto}.tfvars from the examples,
               and set manage_github_connection = true — from here on Terraform owns
               the connection instead of referencing a console-made one
 8.            ./scripts/tf.ps1 staging gcp plan   → expect CREATES ONLY, no imports
               ./scripts/tf.ps1 staging gcp apply
                 One pass: APIs, service accounts, IAM, registry + cleanup policies,
                 secrets AND versions, the GitHub connection, the trigger, Cloud Run.
 9.            Push to `dev` → verify → build → prisma migrate deploy → deploy
                 (migrations run as the OWNER; the app role gets future tables through
                  the default privileges db-bootstrap set)
10.            pnpm db:seed  — once, against the fresh database
                 ⚠️ Run it with DATABASE_URL set to the OWNER (direct) URL for this one
                   command. The seed resets serial sequences with setval(), which needs
                   UPDATE on the sequence — the app role has USAGE+SELECT only, by design.
                   As the app role it fails partway, having already inserted rows.
11.            Write envs/staging/cloudflare/terraform.tfvars, then:

               a) ./scripts/cf-import.ps1 -Environment staging
                    Inventory + import blocks for anything that SURVIVED the teardown.
                    On a clean teardown it finds nothing and says so — delete the
                    generated file and continue. If you chose NOT to destroy the
                    Cloudflare side (a legitimate choice: DNS downtime is the only
                    real cost of a rebuild), this is what makes the apply an adoption
                    instead of an "already exists" collision.

               b) ./scripts/tf.ps1 staging cloudflare plan   → check against §1's register
                  ./scripts/tf.ps1 staging cloudflare apply
                    DNS, Worker + route, Pages + VITE_API_URL, R2 + CORS, zone SSL.
                    The Worker's target comes from the gcp state — nothing is pasted.
12. 🔒         Trigger a frontend rebuild.
                 ⚠️ VITE_API_URL is INLINED AT BUILD TIME. Terraform setting it
                   changes nothing until the next build.
13. 🔒 B4      Add this environment's redirect URI to the OAuth client
14.            §7 verification
```

**Delete the stale provider cache before step 8** if this working copy ever ran the old flat layout:
`infrastructure/terraform/envs/staging/.terraform`.

**Production is the same list** with `envs/prod/`, preceded by `tf.ps1 bootstrap - apply` (which
creates the project, links billing and makes its state bucket) and followed by B5.

---

## 7. Local development after a rebuild

Local is not deployed infrastructure, but it points AT the infrastructure, so it breaks when the
infrastructure is replaced. Two files, both gitignored, both with committed `.example` templates:

**`ozari-api/.env`** — the whole local runtime. After a rebuild, four values change:

| Value | New source |
|---|---|
| `DATABASE_URL` | The new project's pooled URL from `db-bootstrap`. Point local at the **staging** database, or give local its own Neon project — both are fine; sharing with staging is simpler and its data is disposable. |
| `DIRECT_DATABASE_URL` | The new owner URL (local `prisma migrate dev` needs it) |
| `SHADOW_DATABASE_URL` | A throwaway Neon branch, if you use `migrate dev` |
| `ENCRYPTION_KEY` | ⚠️ **Must be the key that database was written with.** Point local at staging's database and local needs staging's key — otherwise every encrypted column reads as corrupt, and the failure looks like a data bug rather than a configuration one. |

The rest keep their local shapes: `APP_HOST=http://localhost:5173`, `API_PUBLIC_URL=` (empty — no
proxy in front of a local server), and whichever R2/Resend/Google values you want local to exercise.

**`ozari-app/.env`** — `VITE_API_URL` is not read in development at all (Vite proxies `/api` to
`localhost:3000`), so there is usually nothing to change.

**The local database role.** If local points at the same database as staging, it uses the same
least-privileged role — which is the point: `prisma migrate dev` locally will be refused, correctly,
because the app role cannot do DDL. Use `DIRECT_DATABASE_URL` for migrations, as the pipeline does.

---

## 8. Verification

```
[ ] db-verify.sql PASSES  (no superuser, no group memberships, no CREATE, owns no tables)
[ ] terraform plan is CLEAN on both stacks immediately after apply
[ ] Nothing belonging to qa-ulew appeared in either plan
[ ] GET https://api-staging.partyrentalsgt.com/api/health/check answers from OUR API
      200 with x-api-key, or 403 — a 403 means Express received it and refused a direct
      browser hit, which is correct. A Google-styled 404 means the Host rewrite did not
      happen: the Worker route or the record's proxy status is wrong.
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

## 9. If it goes wrong halfway

The rebuild has no half-state worth preserving, which is what makes it low-risk: **the recovery for
any failure is to destroy and start §6 again.** There is no data to protect and no user to
inconvenience.

Two specific failures with known causes, so they are not diagnosed from scratch:

- **"service account does not exist"** on the Cloud Build GitHub token binding — the Google-managed
  service agent is created lazily on first use of the API. Materialise it once and re-apply:
  `gcloud beta services identity create --service=cloudbuild.googleapis.com --project=<project>`
- **A Cloudflare apply fails with "already exists"** — an object survived the destroy, or you chose
  not to destroy the Cloudflare side. Either delete it in the dashboard (check §1 first), or run
  `cf-import.ps1` and let Terraform adopt it. Both are correct; pick one per object rather than
  alternating.

The one thing you cannot redo casually is `encryption_key`: if a database has already been written
with it, that key and that database are a pair for life.
