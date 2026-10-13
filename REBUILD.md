# Ozari — Build, Rebuild & Retire an Environment

**What this is:** the ordered procedure for creating an environment from nothing (staging first, then
production — the same list with different inputs), for retiring one, and **the complete list of
everything a human must do by hand**, with exactly where each value goes.

**Read first:** `INFRASTRUCTURE-PLAN.md` (what is automated and why) · `infrastructure/README.md`
(how the scripts and Terraform work) · `DEPLOYMENT.md` (ongoing operations once it is up).

Legend: 🔒 **owner** — a console click or a credential, no API exists · ⚙️ **script** — run by the
owner because it loads secrets (`infrastructure/secrets/`) · ☁️ changes real cloud resources, always
shown as a plan first.

> **Why there is no "adopt the live environment" path any more.** Every environment is built fresh in
> its own new GCP project and Neon project. The pre-rebuild staging (`ozari-500103`) is retired, not
> imported (§5). Nothing carries the history of a hand-made environment: no database role nobody
> can prove is least-privileged, no secret versions Terraform did not create, no console-made
> connection.

---

## 1. The ownership register — what is ours, and what must never be touched

### ⚠️ Never managed by anything in this repo

| Asset | Why |
|---|---|
| **The domain `partyrentalsgt.com`**: registration, renewal, transfer | A purchased, account-level asset. There is **no `cloudflare_zone` and no registrar resource** anywhere, and none may be added. The guarantee comes from the absence of a resource. |
| **The Cloudflare zone itself** | Terraform manages the records *inside* it and the services they point at, nothing above that line. |
| **The GitHub repository** · **the Google, billing, Cloudflare, Neon and Resend accounts** | Same category. |
| **Resend's DNS records** (DKIM/SPF/MX on the zone) | Made by hand when the domain was verified, and they work. Left alone (`extra_dns_records` exists for the day they must change). |

### ⚠️ Never touched — it belongs to someone else

| ❌ NEVER TOUCH | Where |
|---|---|
| **`qa-ulew`**, an unrelated landing page | Cloudflare: its Pages project, its DNS records, any Worker or route it uses. `cf-inventory.ps1` always lists it as **not ours**. |

### ✅ Ours

| | Staging | Production |
|---|---|---|
| GCP project (everything Google inside it) | `ozari-staging-gt` | `ozari-prod-gt` |
| State bucket (inside that project) | `ozari-staging-gt-tfstate` | `ozari-prod-gt-tfstate` |
| Neon project (`aws-us-east-1`) | `ozari-staging` | `ozari-prod` |
| App / API hostnames | `staging.` / `api-staging.partyrentalsgt.com` | `partyrentalsgt.com` / `api.partyrentalsgt.com` |
| R2 bucket / public hostname | `ozari-staging-assets` / `assets-stg.` | `ozari-prod-assets` / `assets.` |
| Pages project / Worker | `ozari-staging` / `ozari-staging-api-proxy` | `ozari-prod` / `ozari-prod-api-proxy` |
| Google OAuth client (Calendar) | in `ozari-staging-gt` | in `ozari-prod-gt` |
| Resend API key | one for staging | one for production |
| Cloud Build trigger branch | `dev` | `main` |

**Pre-rebuild staging, retired at step 3 of §4** (`retire.ps1 legacy-staging`): GCP project
`ozari-500103`, Neon project `ozari`, Worker `api-staging-proxy`, Pages project `ozari` (serving
`ozari-c28.pages.dev`), R2 bucket `ozari-staging` (behind `assets-stg.`), and the A/AAAA/CNAME records
on the three staging hostnames. Pages and R2 are also matched by the hostnames they hold, since a
dashboard-made name is not its address. Owner decision
2026-10-12: its data is disposable, so it goes **before** the new staging is built rather than after.

---

## 2. What a teardown loses for good

| Lost | Consequence |
|---|---|
| Database | Every order, product and client in it. |
| R2 objects | Every product photo and evidence image. ⚠️ The database and the bucket go **together**, or each holds references to things the other has lost (`pnpm reconcile:images` audits it). |
| `encryption_key` | ⚠️ A database kept while its key is regenerated is unreadable **forever** in every `*_kms` column. Destroy both or neither. |
| Google Calendar connections | Every admin reconnects. Events already written stay in their calendars as orphans. |
| ICS feed URLs | Every subscribed device silently stops updating; re-subscribe per device. |
| Sessions | Everyone is logged out. |

---

## 3. The manual steps — the complete list

These are the only things no API can do. Each row says what it produces and **exactly where it
goes**. 

### Group A — once per ACCOUNT (shared by staging and production) → `secrets/account.json`

**One command does all of Group A:** `./infrastructure/scripts/account.ps1`. It asks only for the two
values you must create (A4, A5's key, through hidden prompts that print the exact steps). It detects
the rest: the billing account from gcloud, the Cloudflare ids from the token, and the Neon org from
the key. Pass A2's number as `-GitHubAppInstallationId`, or it prompts. Then it **proves** the
result: the token is active and passes a GET probe for every permission Terraform uses, and the Neon
key can list the org. It also warns if a Neon project already carries a name the build would create,
because `neon.ps1` would reuse that project. The rows below are what it automates, kept here for
reference and for replacing one value (`secret.ps1 account <key>`).

| # | Step | Command to store it |
|---|---|---|
| A1 | **Billing account** with a payment method. `gcloud billing accounts list` → the OPEN one. | `secret.ps1 account billing_account` |
| A2 | **Cloud Build GitHub App** installed on the repo: github.com → Settings → Applications → Google Cloud Build → Configure; the number at the end of the URL. One installation serves every project. | `secret.ps1 account github_app_installation_id` |
| A3 | **Cloudflare account id + zone id**: dashboard → partyrentalsgt.com → Overview → right column. | `secret.ps1 account cloudflare_account_id` · `… cloudflare_zone_id` |
| A4 | **Cloudflare API token** (Custom token): Account → Workers Scripts:Edit, Cloudflare Pages:Edit, Workers R2 Storage:Edit · Zone → DNS:Edit, Zone Settings:Edit, Workers Routes:Edit, Transform Rules:Edit, Zone:Read · Zone resources: only partyrentalsgt.com. Give it an expiry you will notice. | `secret.ps1 account cloudflare_api_token` |
| A5 | **Neon organization id + API key**: Neon console → Organization settings → General → Organization ID (`org-…`); then Organization settings → API keys → Create, an **organization** key (scoped to that org, not to your whole login). `neon.ps1` passes the org id explicitly, so it can never list or create in another org. | `secret.ps1 account neon_org_id` · `… neon_api_key` |
| A6 | **Cloudflare Pages ↔ GitHub authorisation**: already done on this account (the old `ozari-c28` was Git-connected). On a NEW account: connect any Pages project to GitHub once, then delete it. | — |

### Group B — once per ENVIRONMENT → `secrets/<env>.json`

| # | Step | When | Command to store it |
|---|---|---|---|
| B1 | **GitHub token for Cloud Build**: github.com → Settings → Developer settings → **Tokens (classic)**, scopes `repo` + `read:user`, expiry ~1 year (put a reminder in your calendar: an expired token silently stops deploys). ⚠️ Cloud Build rejects fine-grained (`github_pat_…`) tokens. One per environment, so revoking staging's never stops a production deploy. | any time | `secret.ps1 <env> github_oauth_token` |
| B2 | **Resend API key**, "Sending access", one per environment. The domain is already verified. *(First staging rebuild: `retire.ps1 legacy-staging` carries the old staging's key over, so this row is already filled.)* | any time | `secret.ps1 <env> email_key` |
| B3 | **R2 API token**: Cloudflare → R2 → Manage API tokens → **Create Account API token**, name `ozari-<env>-assets` → **Object Read & Write**, *Apply to specific buckets only* → this environment's bucket, TTL Forever. Copy the **Access Key ID** and **Secret Access Key** only — the `cfat_…` "Token value" and the "jurisdiction-specific endpoint" are not used (the API speaks S3 with the key pair, and Terraform derives the endpoint from the account id). On that same page, delete any token that served a retired environment. | after the Cloudflare apply (the bucket must exist) | `secret.ps1 <env> r2_access_key` · `… r2_secret_key` |
| B4 | **Google OAuth client** for Calendar, created in **this environment's project**: the full procedure is `DEPLOYMENT.md` §3d (audience External, scopes `calendar.events` + `userinfo.email` only, a Web client, this environment's redirect URI). | after bootstrap (the project must exist) | `secret.ps1 <env> google_client_id` · `… google_client_secret` |
| B5 | *(production, after launch)* **Publish the consent screen and complete Google's verification.** ⚠️ An app left in Testing expires refresh tokens after ~7 days, so calendars silently go stale a week after launch. | later | — |

**Generated, not clicked** (listed so nothing is missed): `neon.ps1` → `database_url`,
`direct_database_url` · `new-secrets.ps1` → `jwt_secret`, `jwt_refresh_secret`, `encryption_key`,
`api_key`.

⚠️ **Every value differs between staging and production.** The scripts generate fresh ones per
environment. For the clicked ones, mint a separate key per environment.

⚠️ **Back up `infrastructure/secrets/` off this machine** as soon as `encryption_key` exists. That
directory is the recovery set; Terraform state holds none of it. Back up **every file in it**
(`account.json`, `staging.json`, later `prod.json`) into a password manager, again after any script
changes one. Losing a value differs by kind:

| Lost | Consequence | Recovery |
|---|---|---|
| `encryption_key` | Every `*_kms` column (client PII) is unreadable **forever** | Only a backup, or `gcloud secrets versions access latest --secret=ozari-encryption-key --project=<project>` while the project exists |
| `jwt_secret`, `jwt_refresh_secret`, `api_key` | Nothing permanent | Regenerate (`new-secrets.ps1`) + gcp apply; everyone signs in again |
| `database_url`, `direct_database_url` | Nothing permanent | `neon.ps1 <env> -RotateAppPassword -RotateMigratorPassword` + gcp apply |
| Clicked keys (Cloudflare, Neon, GitHub, Resend, R2, Google) | Nothing permanent | Mint a new one (register below), `secret.ps1`, apply |

The committed templates `infrastructure/templates/account.example.json` and `env.example.json` are
what a new operator starts from: every script creates the real file from them on first use, and their
`_readme` says where each value comes from. Never put a value in a template.

### The credential register — every key that lives OUTSIDE this repo

What each one is called where it was created, what it can do, and who uses it — so a list in a
provider's dashboard can always be matched to a purpose before anything is deleted.

| Name in the provider | Where | Can do | Used by | Expiry → replace with |
|---|---|---|---|---|
| `ozari-terraform-local` | Cloudflare → My Profile → API Tokens (a **User** token) | Edit Workers, Pages, R2 buckets, and DNS / zone settings / Worker routes / transform rules on `partyrentalsgt.com` only | `tf.ps1` (cloudflare stack), `retire.ps1`, `cf-inventory.ps1`, `account.ps1` — from the operator's machine only ("local"), never in a cloud or CI; shared by staging and production | ~1 year → new token with the A4 scopes, `secret.ps1 account cloudflare_api_token` |
| `ozari-<env>-assets` | Cloudflare → R2 → Manage API tokens (an **Account** token) | Read/write objects in ONE bucket; cannot create, delete or configure anything | The API on Cloud Run (photos) | none → B3 |
| Neon organization API key | Neon → Organization settings → API keys | Manage projects in the Ozari org only | `account.ps1`, `neon.ps1`, `retire.ps1` | none → A5 |
| `ozari cloud-build <env>` | GitHub → Developer settings → Tokens (classic) | Read the repo for Cloud Build's connection | Cloud Build's service agent (Secret Manager) | ~1 year → B1 |
| One Resend key per environment | Resend → API Keys | Send email from the verified domain | The API on Cloud Run | none → B2 |
| `Ozari Google Calendar (<env>)` | Google Auth Platform → Clients, in the environment's project | Ask an admin's consent for `calendar.events` + `userinfo.email` | The API on Cloud Run | none → B4 |

**Replacing them in an emergency** — all at once, in the right order — is `rotate.ps1 <env>`
(`INCIDENTS.md`).

The service accounts (`ozari-run-sa`, `ozari-build-sa`) have no keys at all: Google issues them
short-lived credentials, and Terraform owns their permissions.

---

## 4. Build an environment — the ordered procedure

Written for staging. **Production is the same list** with `prod` in every command and the production
column of §1. The prod-only differences are called out inline.

```
 0.    PREREQUISITES (once per machine)
         winget install Hashicorp.Terraform        (>= 1.11; 1.16.x current)
         gcloud auth login
         gcloud auth application-default login
         cd ozari-api; pnpm install; cd ..         (neon.ps1 and db-seed.ps1 use its pg/Prisma)

 1. 🔒 Group A (once per account) → secrets/account.json
         ./infrastructure/scripts/account.ps1 [-GitHubAppInstallationId <n>]
           asks only for the two tokens, detects the rest, proves every permission; re-runnable

 2. ☁️⚙️ Bootstrap: project + billing + state bucket
         ./infrastructure/scripts/tf.ps1 staging bootstrap plan
         ./infrastructure/scripts/tf.ps1 staging bootstrap apply
           First run: local state → bucket created → state migrated into it (automatic).
           "project id already exists" = taken globally: change project_id AND state_bucket in
           envs/staging/environment.json and re-plan.
         gcloud auth application-default set-quota-project ozari-staging-gt
           (ADC's quota project must be a project that will keep existing — see infrastructure/README)

 3. ☁️⚙️ FIRST STAGING REBUILD ONLY — retire the pre-rebuild staging (it holds the same hostnames)
         ./infrastructure/scripts/retire.ps1 legacy-staging            # dry run: lists every deletion
         ./infrastructure/scripts/retire.ps1 legacy-staging -Execute   # type the name to confirm
           Copies the old Resend key into secrets/staging.json, then deletes: Worker route + Worker,
           the Pages project holding staging. (deployments first), the bucket holding assets-stg.
           (custom domain, objects, bucket), the staging A/AAAA/CNAME records, Neon project `ozari`, and LAST project
           ozari-500103 (recoverable 30 days). Switches gcloud's ADC quota project and default
           project to ozari-staging-gt first. Re-runnable: finished steps are skipped.
           ⚠️ The old staging site goes down here; the new one is up after step 11.
           The dry run prints ozari-c28's build variables — tell Claude if anything besides
           NODE_VERSION needs carrying into `pages_build_env`.
         Any other environment: `cf-inventory.ps1 <env>` must show no CONFLICT before step 6.

 4. ☁️⚙️ Database
         ./infrastructure/scripts/neon.ps1 staging
           Creates Neon project `ozari-staging` (aws-us-east-1, Postgres 18, 0.25–1 CU), then with
           SQL `ozari_migrator` (owns the schema) and `ozari_api` (DML only), PROVES each holds only
           what its job needs, saves both URLs. Prints no secret. The DBA login is never stored.

 5.    ⚙️ Generated secrets
         ./infrastructure/scripts/new-secrets.ps1 staging

 6. ☁️⚙️ Edge: R2 + CORS + custom domain, DNS, Worker + route, Pages (Git-connected)
         ./infrastructure/scripts/tf.ps1 staging cloudflare plan
         ./infrastructure/scripts/tf.ps1 staging cloudflare apply
           The Worker targets ozari-api-<project_number>.us-east4.run.app, Cloud Run's deterministic
           hostname. It answers 404 until step 9 deploys the service; that is expected.
           PROD: this root also sets the zone-wide SSL settings (strict, Always Use HTTPS).

 7. 🔒 Group B → secrets/staging.json
         B1 GitHub classic token · B2 Resend key · B3 R2 token (bucket now exists)
         B4 OAuth client in ozari-staging-gt (redirect URI:
            https://api-staging.partyrentalsgt.com/api/calendar/google/callback)
         ./infrastructure/scripts/secret.ps1 staging          # must show no EMPTY rows

 8. ☁️⚙️ Google Cloud: APIs, SAs, IAM, registry, secrets WITH values, GitHub connection,
         trigger, Cloud Run — one pass
         ./infrastructure/scripts/tf.ps1 staging gcp plan     # expect CREATES only
         ./infrastructure/scripts/tf.ps1 staging gcp apply
           Cloud Run starts on Google's public sample image (the registry is still empty), so
           api-staging shows Google's "It's running!" page until step 9 replaces it.

 9. ☁️ First deploy (Claude can run this one — it loads no secrets)
         gcloud builds triggers run ozari-api-staging --branch=dev --region=us-east4 --project=ozari-staging-gt
           verify → build → push → prisma migrate deploy (as ozari_migrator) → gcloud run deploy.
           From now on every push to `dev` that touches ozari-api/ deploys.
           PROD: trigger ozari-api-prod, branch main (create `main` from `dev` first).

10.    ⚙️ Reference data, once
         ./infrastructure/scripts/db-seed.ps1 staging          # as the migrator; idempotent
           Also revokes the app role's access to _prisma_migrations, which step 9 just created.

11. ☁️⚙️ First frontend build (a brand-new Pages project has never built)
         ./infrastructure/scripts/pages-build.ps1 staging
           From now on every push to `dev` that touches ozari-app/ builds.

12.    The first admins — a new environment starts with registration OPEN (step 8 found no
       service, so tf.ps1 passed "open"):
         each admin registers at the app → promote them in pgAdmin (DEPLOYMENT.md §3,
            UPDATE users SET role_id = 2 …) → they sign out and back in
         Once there are enough users:
         ./infrastructure/scripts/registration.ps1 staging close     # no commit: the live service is the record

13.    §6 verification.
```

### 4b. Production — the exact run

Everything staging tripped over on 2026-10-13 is fixed in code (Cloud Run's bootstrap image, the
trigger SA's connection access, the IAM 409 race, the visitor IP behind the Worker), so this is §4
with `prod` inputs and no surprises expected. Group A is shared and done; there is nothing to
retire. Counts below are what the plans should show — anything else: stop and look.

```
 0. ⚙️ main must exist (production deploys ONLY from it; neither trigger nor Pages can build without it)
         git fetch origin; git push origin origin/dev:refs/heads/main
           (or GitHub → Branches → New branch: main, from dev). From now on: feature → dev
           (staging) → PR dev → main (production).
    🔒 B1 + B2 now (no dependency): GitHub classic token "ozari cloud-build prod" (repo + read:user,
           ~1 year) and a Resend key "ozari-prod" (Sending access, partyrentalsgt.com):
         ./infrastructure/scripts/secret.ps1 prod github_oauth_token
         ./infrastructure/scripts/secret.ps1 prod email_key

 1. ☁️⚙️ Bootstrap — the project, its billing link, its state bucket
         ./infrastructure/scripts/tf.ps1 prod bootstrap plan     # expect 6 to add
         ./infrastructure/scripts/tf.ps1 prod bootstrap apply
           Note the project number in the output: the Worker targets ozari-api-<number>.us-east4.run.app.

 2.    Nothing in Cloudflare may hold a production hostname
         ./infrastructure/scripts/cf-inventory.ps1 prod          # expect NO CONFLICT
           Also read its "not ours" DNS rows: step 5 sets the ZONE-WIDE SSL mode to Full (strict),
           which every proxied hostname on the zone must survive (a valid origin certificate).
           Pages, Workers and R2 always do; anything else proxied — check it before step 5.

 3. ☁️⚙️ Database — Neon project ozari-prod + the migrator and app roles, every check PASS
         ./infrastructure/scripts/neon.ps1 prod

 4.    Generated secrets — jwt_secret, jwt_refresh_secret, encryption_key, api_key
         ./infrastructure/scripts/new-secrets.ps1 prod
    🔒 BACK UP prod.json to 1Password NOW (encryption_key exists from this moment).

 5. ☁️⚙️ Cloudflare — apex Pages (branch main), api Worker, assets bucket, ZONE-WIDE SSL settings
         ./infrastructure/scripts/tf.ps1 prod cloudflare plan    # expect 13 to add: staging's 12,
                                                                 #   minus the noindex rule, plus 2
                                                                 #   zone settings (ssl, always_use_https)
         ./infrastructure/scripts/tf.ps1 prod cloudflare apply

 6. 🔒 B3 + B4 (both need what steps 1 and 5 created)
         B3 R2 → Manage API tokens → Create Account API token "ozari-prod-assets", Object Read &
            Write, ONLY bucket ozari-prod-assets, TTL Forever → Access Key ID + Secret Access Key:
         ./infrastructure/scripts/secret.ps1 prod r2_access_key
         ./infrastructure/scripts/secret.ps1 prod r2_secret_key
         B4 console → project ozari-prod-gt → Google Auth Platform (DEPLOYMENT.md §3d): External,
            scopes calendar.events + userinfo.email, test users, Web client
            "Ozari Google Calendar (prod)" with ONLY this redirect URI (no localhost):
              https://api.partyrentalsgt.com/api/calendar/google/callback
         ./infrastructure/scripts/secret.ps1 prod google_client_id
         ./infrastructure/scripts/secret.ps1 prod google_client_secret
         ./infrastructure/scripts/secret.ps1 prod                # no EMPTY rows
    🔒 BACK UP prod.json again.

 7. ☁️⚙️ Google Cloud — one pass
         ./infrastructure/scripts/tf.ps1 prod gcp plan           # expect 76 to add: staging's original 58,
                                                                 #   + the trigger SA's connection grant,
                                                                 #   + 17 for the spend cap (6 APIs, topic +
                                                                 #   its IAM, budget, SA + its role, source
                                                                 #   bucket + object + 2 build reads,
                                                                 #   function, invoker);
                                                                 #   "Registration: … new environment -> OPEN"
         ./infrastructure/scripts/tf.ps1 prod gcp apply
           A Google-side "internal error" on Cloud Run or a 409 on IAM: §8 troubleshooting (untaint,
           plan, apply). Then a second plan must show NO CHANGES.
       Prove the spend cap without firing it (Claude can run this — no secrets): a dry-run message
       at 100 % must log "WOULD unlink billing (permission OK)":
         gcloud pubsub topics publish ozari-spend-cap --project=ozari-prod-gt "--attribute=dryRun=true,costAmount=5,budgetAmount=5" --message=test
         gcloud functions logs read ozari-spend-cap --gen2 --region=us-east4 --project=ozari-prod-gt --limit=5
       (Values go in attributes, and the argument stays QUOTED: Windows PowerShell strips the quotes
       out of a JSON --message and splits an unquoted comma list — "unusable notification, ignored"
       in the log means exactly that. Verified on staging 2026-10-13: permission OK. Right
       after the apply, "The request was not authenticated" for a minute or two is the invoker grant
       propagating; Pub/Sub retries and the next delivery gets through.)

 8. ☁️ First deploy (Claude can run it — it loads no secrets)
         gcloud builds triggers run ozari-api-prod --branch=main --region=us-east4 --project=ozari-prod-gt
         ./infrastructure/scripts/db-seed.ps1 prod
         ./infrastructure/scripts/pages-build.ps1 prod

 9.    The first admins (registration starts OPEN): each registers at https://partyrentalsgt.com →
       promote in pgAdmin (Neon → ozari-prod → Connect, neondb_owner, pooling OFF; DEPLOYMENT.md §3)
         ./infrastructure/scripts/registration.ps1 prod close

10.    Before anyone else uses it
         ./infrastructure/scripts/rotate.ps1 prod -Only sessions,api_key,database   # record it in INCIDENTS.md §4
       §6 verification + DEPLOYMENT.md §11 launch gates (/api/docs ABSENT on api.partyrentalsgt.com).
    🔒 prod.json to 1Password (the drill changed it). The US$5 hard spend cap is already live
       (step 7); the Cloudflare budget alert is account-wide, so it is already set from staging
       (DEPLOYMENT.md §12).

Later, before real customers: publish production's OAuth consent screen and start Google's
verification (B5 — in Testing, calendar sync dies after ~7 days); `enable_cleanup_job = true` in
envs/prod/gcp once there are real users.
```

Each environment is hard-capped at US$5/month on Google (`monthly_budget_usd`, INCIDENTS.md S12);
every other provider's limit, and how to change any of them: `DEPLOYMENT.md` §12.
Cost after it: about **US$1.2/month for both environments** — production adds ~US$0.72 of Secret
Manager versions (the 6 free versions are per billing account and staging already uses them) and a
cent of registry storage (it keeps 3 rollback images instead of 2).

---

## 5. Retire an environment

Retiring is deleting **projects**, not running `terraform destroy` resource by resource. Everything
Google holds for an environment lives inside its own GCP project, including the Terraform state.
Neon and Cloudflare objects are few and listed by name in ONE table (`Get-OzTarget`, shared with
`cf-inventory.ps1`).

```
1. ☁️⚙️ ./infrastructure/scripts/retire.ps1 <staging|prod|legacy-staging>            # dry run
   ☁️⚙️ ./infrastructure/scripts/retire.ps1 <staging|prod|legacy-staging> -Execute   # type the name
      Cloudflare (routes, Worker, Pages + deployments, R2 domain + objects + bucket, then the
      A/AAAA/CNAME records on its hostnames; MX/TXT/CAA are never touched) → Neon project →
      GCP project LAST (it holds the R2 keys used to empty the bucket; skipped if anything
      before it failed). Google keeps a deleted project recoverable for 30 days
      (`gcloud projects undelete`). gcloud's ADC quota and default project are switched to the
      other environment first; the script refuses if that one does not exist.
2. 🔒 Revoke what was minted for it by hand: its GitHub classic token (github.com → Settings →
      Developer settings), its Resend key, its R2 token (R2 → Manage API tokens). The OAuth client
      went with the project.
3.    Archive or delete infrastructure/secrets/<env>.json — its values are now dead.
```

**Never deleted:** the domain and its zone, the Resend domain verification, the Cloud Build GitHub
App installation and the Pages GitHub authorisation (both reused by the next environment), and
anything belonging to `qa-ulew`.

---

## 6. Verification

```
[ ] neon.ps1 <env> -VerifyOnly PASSES (migrator owns every object with no server powers; app is
      DML-only, member of nothing, owns nothing; default privileges in place)
[ ] tf.ps1 <env> cloudflare plan  and  tf.ps1 <env> gcp plan  show NO CHANGES right after apply
      (and still none after the first Cloud Build deploy: the deploy must not fight Terraform)
[ ] rotate.ps1 <env> -Only sessions,api_key,database drilled once, BEFORE the environment has users,
      and ended with the green health check (INCIDENTS.md §4)
[ ] Nothing belonging to qa-ulew appeared in any plan or deletion
[ ] GET https://api-<env>.partyrentalsgt.com/api/health/check answers from OUR API
      200 with x-api-key, or 403 without (Express received it and refused a direct hit — correct).
      A Google-styled 404 = the Worker route/target is wrong.
[ ] /api/docs served on staging, ABSENT on production (the NODE_ENV gate)
[ ] register → login → forgot-password (email arrives) → reset → login
[ ] registration.ps1 <env> status, and the app matches it — open: "regístrate aquí" on the login
      page; closed: no link, and /sesion/registro shows "registro cerrado"
[ ] a product photo upload succeeds and displays     (R2 credentials, CORS and the custom domain)
[ ] an order can be created, advanced, paid, and its PDF opens
[ ] iPhone: log in, wait > 15 min, still logged in   (first-party cookies)
[ ] Calendar: connect Google; an order's events appear in the ASSIGNEE's calendar only
[ ] pnpm reconcile:images reports CLEAN
[ ] req.ip resolves to the real client, not a Cloudflare edge address (DEPLOYMENT.md §3c)
[ ] after a few builds: Artifact Registry under 0.5 GB
[ ] spend cap: Billing → Budgets shows ozari-<env>-cap at US$5, and a dryRun=true message at 100 %
      logs "WOULD unlink billing (permission OK)" (§4b step 7)
```

---

## 7. Local development after a rebuild

Local is not deployed infrastructure, but it points AT it, so it breaks when that is replaced.
`ozari-api/.env` (gitignored, `.env.example` beside it) changes in four values:

| Value | New source |
|---|---|
| `DATABASE_URL` | Point local at **staging's** database (simplest; its data is disposable): the `database_url` in `secrets/staging.json`. Or give local its own Neon project. |
| *(migrations)* | Local Prisma reads only `DATABASE_URL`. For a `prisma migrate`/`diff` command, set `DATABASE_URL` to staging's `direct_database_url` (the migrator) **for that one command**, never in `.env`. |
| `SHADOW_DATABASE_URL` | a throwaway Neon branch, if you use `migrate dev` |
| `ENCRYPTION_KEY` | ⚠️ **The key that database was written with**: staging's `encryption_key`. Any other key makes every encrypted column read as corrupt, which looks like a data bug. |

The R2 values (`R2_BUCKET_NAME=ozari-staging-assets`, `R2_PUBLIC_URL=https://assets-stg.partyrentalsgt.com`),
Resend and Google values follow the same idea. Keep `APP_HOST=http://localhost:5173` and
`API_PUBLIC_URL=` empty. Local uploads go to the staging bucket, which is why its CORS lists
`localhost:5173`. Add `http://localhost:3000/api/calendar/google/callback` to staging's OAuth client
if you test Calendar locally.

Local uses the same DML-only role as staging, so `prisma migrate dev` against `DATABASE_URL` is
refused, correctly. Migrations go through the migrator, as the pipeline does.

---

## 8. If it goes wrong halfway

A fresh environment has no state worth preserving. The recovery for any failure is to fix the cause
and re-run the same step. Each step is idempotent: plans show only what is missing, and `neon.ps1`
reuses the project it finds.

Known failures, so they are not diagnosed from scratch:

- **Bootstrap: "project id already exists"**: the id is taken globally. Change `project_id` and
  `state_bucket` in `environment.json`.
- **Bootstrap: billing error**: you lack `roles/billing.user` on that billing account, or it has
  reached its limit of linked projects (Google raises it on request).
- **Any Google call names `ozari-500103` after it was deleted**: the ADC quota project. Run
  `gcloud auth application-default set-quota-project ozari-staging-gt`.
- **Cloudflare apply: "already exists"**: something still holds a hostname. `cf-inventory.ps1 <env>`
  names it. If it is the pre-rebuild staging, re-run `retire.ps1 legacy-staging -Execute`.
- **gcp apply stops at the GitHub connection / repository**: the classic token is wrong, expired or
  fine-grained, or the installation id is wrong — or, on a first apply with a "permission denied" on
  the token secret, Google had not finished propagating the grant made seconds earlier: wait a
  minute, then plan and apply again (only what is missing is created). Otherwise replace it (`secret.ps1 <env> github_oauth_token`
  bumps its counter), then plan and apply again.
- **First gcp apply: Cloud Run "The service has encountered an internal error", or an IAM "409
  concurrent policy changes"**: Google-side races on a project whose APIs were enabled seconds
  earlier. The failed service is marked *tainted*, and replacing it is blocked by deletion
  protection — so clear the mark instead of deleting anything:
  `terraform -chdir=infrastructure/terraform/envs/<env>/gcp untaint module.gcp.google_cloud_run_v2_service.api`,
  then plan + apply again for whatever else is missing. The service itself is repaired by step 9's
  first deploy, which creates a fresh revision regardless.
- **Right after an edge rebuild, a browser gets 403/503 from the API, and Cloud Run's logs show
  NOTHING for those requests** (seen 2026-10-13): a browser that had the OLD site open keeps its
  HTTP/2-3 connections to Cloudflare alive for hours (the app polls), and may send API requests over
  a connection opened for the website under the previous configuration. Cloudflare refuses a
  request whose hostname does not match the connection (an empty 403/503, a handful of headers; even
  `/cdn-cgi/trace` fails on it) before any Worker runs. **Fix: fully quit the browser and reopen it.**
  Fresh visitors never see it. Proof it is this: the same request works in an Incognito window, or
  through a page on another site, and `curl` from the same machine always works.
- **`POST /api/auth/refresh` → 403 "Token CSRF faltante / no coincide" right after a rebuild**: the
  browser still holds a `refresh-token` cookie from the PREVIOUS environment (same hostname,
  different keys). Expected and harmless — the app treats it as "not signed in" and shows the login;
  the next sign-in replaces the cookie.
- **First build fails at `apply-prisma-migrations`**: Secret Manager holds a migrator password the
  database no longer accepts (a `neon.ps1` rotation without the gcp apply after it: run the apply), or
  Neon is unreachable. `neon.ps1 <env> -VerifyOnly` proves the roles themselves are right.
- **`neon.ps1`: "password authentication failed for user ozari_migrator"**: an earlier run set a
  password and failed before saving it. Re-run with `-RotateMigratorPassword`.
- **`retire.ps1`: a FAIL line**: fix what it names and re-run; finished steps are skipped, and the
  GCP project is only deleted once everything before it succeeded.

The one thing you cannot redo casually is `encryption_key`: once a database has been written with
it, that key and that database are a pair for life.
