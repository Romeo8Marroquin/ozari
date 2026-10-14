# Ozari Infrastructure (Terraform + scripts)

The operating manual: how to run what is in this directory. **What is automated and why** is
[`INFRASTRUCTURE-PLAN.md`](../INFRASTRUCTURE-PLAN.md); **building or erasing a whole environment, in
order** is [`REBUILD.md`](../REBUILD.md); **day-to-day releases, rotation and emergencies** are
[`DEPLOYMENT.md`](../DEPLOYMENT.md).

> **Public repo safety.** Nothing in git holds a secret value, an account-identifying id, a service
> account key or Terraform state. Every value lives in `infrastructure/secrets/` (gitignored) and
> every key it must contain is in `infrastructure/templates/` (committed).

---

## Layout

```
infrastructure/
  secrets/                    GITIGNORED — the only place values live. Back it up OFF this machine.
    account.json              shared by every environment: billing, Cloudflare ids + token, Neon key,
                              Cloud Build GitHub App installation id
    staging.json | prod.json  one environment's secret values + rotation counters
  templates/                  account.example.json, env.example.json — every key, no values
  scripts/
    tf.ps1                    THE way to run Terraform: plan → review → apply that saved plan
    account.ps1               fill account.json: asks for the 2 tokens, detects the rest, proves permissions
    secret.ps1                put one value into a secrets file through a hidden prompt; status view
    new-secrets.ps1           generate JWT / encryption / API key material into a secrets file
    neon.ps1                  Neon project → least-privileged app role → verified → URLs saved
    db-bootstrap.mjs          (called by neon.ps1) creates/rotates migrator + app roles, PROVES their limits
    db-seed.ps1               pnpm db:seed against an environment, as the migrator
    cf-inventory.ps1          read-only Cloudflare inventory: OURS / CONFLICT / not ours
    expiry.ps1                read-only: the real expiry date of each expiring token (REBUILD.md §3)
    rotate.ps1                EMERGENCY: rotate an environment's credentials in one guided run (INCIDENTS.md)
    registration.ps1          open / close / status of new-account registration (the live service is the record)
    retire.ps1                delete an environment everywhere (dry run by default; GCP project last)
    r2-empty.mjs              (called by retire.ps1) count / empty one R2 bucket
    pages-build.ps1           start a Pages production build now (after a VITE_API_URL change)
    lib/Ozari.Infra.psm1      shared helpers (the secrets layout is documented at its top)
  terraform/
    modules/
      bootstrap/              project + billing link + state bucket
      gcp-env/                every Google Cloud resource an environment needs
      cloudflare-env/         DNS, the edge Worker, Pages, R2, zone settings
    envs/
      staging/
        environment.json      COMMITTED identity: project id, region, state bucket, Neon settings
        bootstrap/  gcp/  cloudflare/        inputs only — each its own root and state
      prod/                   the same, with production inputs
```

**An environment is a set of inputs, not a copy of the code.** Everything real lives in `modules/`.
If production ever needs something staging does not have, it goes into the module behind a variable —
never into a file that exists in one environment only, because that file is untested until the day
it matters.

**Each environment is self-contained.** Its project holds its own state bucket
(`<project>-tfstate`), with three state prefixes: `ozari/bootstrap`, `ozari/gcp`, `ozari/cloudflare`.
Deleting staging's project cannot reach production's state.

| Environment | State bucket | Holds |
|---|---|---|
| staging | `gs://ozari-staging-gt-tfstate` (in `ozari-staging-gt`) | `ozari/bootstrap`, `ozari/cloudflare`, `ozari/gcp` |
| prod | `gs://ozari-prod-gt-tfstate` (in `ozari-prod-gt`) | same three |

The bucket is versioned (a bounded history of each state file) and holds **no secret values**
(they are write-only). Look at it with `gcloud storage ls -r gs://<project>-tfstate`, or in the
console: the project → **Cloud Storage → Buckets**. Not to be confused with the two other "storages":
**Artifact Registry** `ozari-images` holds the API's Docker images (empty until the first deploy),
and the **Cloudflare R2** bucket `ozari-<env>-assets` holds the product photos.

**What deleting a project does to its state.** The state goes WITH the project — including the state
of that environment's **Cloudflare** objects, which live outside Google. That is safe only because
nothing in the teardown needs state: `retire.ps1` finds every object by its name (`Get-OzTarget`),
deletes Cloudflare and Neon FIRST and the project LAST. So:

- **Retiring on purpose**: always `retire.ps1 <env>` (`REBUILD.md` §5), never a console delete of the
  project — that would orphan the Cloudflare and Neon objects, still serving and still billing.
- **Project deleted by mistake**: within 30 days, `gcloud projects undelete <project>` brings it back;
  then `tf.ps1 <env> gcp plan` shows what is missing and `apply` recreates it. Past 30 days, or if
  the state is lost while the resources still exist: `retire.ps1 <env>` removes what is left by name,
  and the environment is rebuilt from scratch (`REBUILD.md` §4) — environments are built fresh,
  never adopted, so there is no state to reconstruct by hand.

**Three roots per environment, applied in this order:**

| Root | Creates | Credentials |
|---|---|---|
| `bootstrap` | the GCP project, its billing link, the state bucket | Google ADC + `billing_account` |
| `cloudflare` | R2 bucket + CORS + custom domain, DNS, Worker + route, Pages (Git-connected), zone settings (prod) | Cloudflare token; Google ADC to read the bootstrap state |
| `gcp` | APIs, service accounts, IAM, registry + cleanup policies, secrets **with values**, GitHub connection, trigger, Cloud Run | Google ADC |

Cloudflare goes **before** GCP on purpose. The GCP root needs the R2 credentials, which can only be
minted once the bucket exists. The Worker does not need the service to exist: it targets Cloud
Run's **deterministic** hostname, `ozari-api-<project_number>.<region>.run.app`, computed from the
bootstrap state.

---

## Prerequisites (one-time, per machine)

| Tool | Why | Install / check |
|---|---|---|
| **Terraform ≥ 1.11** (1.16.x is current) | `secret_data_wo` write-only arguments | `winget install Hashicorp.Terraform` · `terraform version` |
| **gcloud** | Terraform's Google credentials; the state-bucket probe | `gcloud auth login` **and** `gcloud auth application-default login` |
| **Node 22 + pnpm** | `neon.ps1` (Neon CLI via `pnpm dlx`), `db-bootstrap.mjs` and `db-seed.ps1` (they use ozari-api's own `pg` and Prisma) | `pnpm install` inside `ozari-api/` once |

Nothing else: no `psql`, no Docker, no Neon or Cloudflare CLI to install.

⚠️ **Every `.ps1`/`.psm1` here must be saved as UTF-8 WITH a BOM.** Windows PowerShell 5.1 reads a
BOM-less file as ANSI. The `—` and `→` in these scripts then decode to bytes PowerShell treats as
**quote characters**, and the script fails to parse at a line that looks perfectly fine. PowerShell 7
hides the problem, which is why it is written down. `.mjs`, `.json` and `.tf` files must NOT have a
BOM.

⚠️ **ADC quota project.** gcloud's Application Default Credentials carry a "quota project". If that
project is deleted (it currently is `ozari-500103`, which the rebuild retires), every
bootstrap-time call fails naming a project that no longer exists. After the new staging project
exists:
`gcloud auth application-default set-quota-project ozari-staging-gt`. The `gcp` roots are immune:
they bill API quota to their own project (`user_project_override`).

---

## Values: where they live and how they get there

| File | Holds | Filled by |
|---|---|---|
| `terraform/envs/<env>/environment.json` | project id, region, state bucket, Neon project/region/version/CU | committed; edit by hand |
| `secrets/account.json` | `billing_account`, `github_app_installation_id`, `cloudflare_account_id`, `cloudflare_zone_id`, `cloudflare_api_token`, `neon_org_id`, `neon_api_key` | `account.ps1` (all at once, verified); `secret.ps1 account <key>` to replace one |
| `secrets/<env>.json` → `secrets` | the 12 secret values the environment runs on | `neon.ps1`, `new-secrets.ps1`, `secret.ps1 <env> <key>` |
| `secrets/<env>.json` → `rotation` | one counter per secret key (absent = 1) | bumped automatically when a script replaces a value |

```powershell
./infrastructure/scripts/account.ps1                              # fill + verify account.json (asks for 2 tokens)
./infrastructure/scripts/secret.ps1 account                       # status: which keys are set (never values)
./infrastructure/scripts/secret.ps1 account cloudflare_api_token  # hidden prompt
./infrastructure/scripts/secret.ps1 staging email_key
./infrastructure/scripts/new-secrets.ps1 staging                  # fills jwt*, encryption_key, api_key if empty
./infrastructure/scripts/neon.ps1 staging                         # fills database_url + direct_database_url
```

`tf.ps1` turns these into **process** environment variables for the one Terraform run
(`TF_VAR_*`, `CLOUDFLARE_API_TOKEN`) and removes them on exit. A Cloudflare token as a *provider
argument* would be written into state; as an environment variable it is not. The secret values
reach Secret Manager through `secret_data_wo` (write-only): sent once, never stored in state or in a
saved plan.

> **For Claude sessions:** the project's `.claude/settings` deny reading `**/secrets/**`. Commands
> that LOAD secrets — `account.ps1`, `retire.ps1`, `rotate.ps1`, `registration.ps1 open|close`, `tf.ps1 plan|apply|output`, `neon.ps1`, `db-seed.ps1`, `cf-inventory.ps1`,
> `expiry.ps1`, `pages-build.ps1` — are run by the owner, in a terminal or with the `!` prefix. Plans print no
> secret values (they are ephemeral/sensitive), so pasting a plan back is safe. `tf.ps1 … validate`
> needs no credentials.

---

## Everyday commands

```powershell
./infrastructure/scripts/tf.ps1 staging gcp plan        # validate + plan, saved to .terraform/ozari.tfplan
./infrastructure/scripts/tf.ps1 staging gcp apply       # applies THAT plan after you type "staging"
./infrastructure/scripts/tf.ps1 staging cloudflare plan
./infrastructure/scripts/tf.ps1 staging gcp output
./infrastructure/scripts/tf.ps1 prod gcp validate       # offline; no credentials
```

What the wrapper adds over raw Terraform:
- the Terraform version check;
- the backend bucket and every input, with no tfvars file to keep in sync;
- a refusal to plan `gcp` while any secret is EMPTY (an empty Secret Manager version is a container
  that dies at startup with an error that points at nothing);
- **plan → apply the saved plan**: what you reviewed is exactly what happens, and a plan made stale by
  any change in between is rejected by Terraform itself;
- a typed confirmation (`-Yes` skips it, for a saved plan you have already reviewed);
- bootstrap's first run, done right: a local backend until the bucket exists, then the state is
  migrated into the bucket and the local copy is deleted.

**There is no `destroy` verb, deliberately.** Retiring an environment is `REBUILD.md` §5.

---

## Secrets

**Terraform owns the containers, the IAM *and* the versions** (`modules/gcp-env/secrets.tf` is the
registry: one entry gives a secret its container, version, IAM, Cloud Run binding and Cloud Build
`--set-secrets` entry).

**To rotate a secret:** replace the value (`secret.ps1 <env> <key>`, or
`new-secrets.ps1 <env> -Rotate jwt_secret`, or `neon.ps1 <env> -RotateAppPassword`). The script bumps
that key's rotation counter. Then `tf.ps1 <env> gcp plan` → `apply`. The new version is created and
the superseded one is **destroyed in the same apply**, which keeps the Secret Manager bill flat
because Google charges for every enabled version. A rotation cannot be undone on Google's side; to
roll back, re-enter the old value, which bumps the counter again.

A rotation of any secret the API reads also **rolls a new Cloud Run revision in that same apply**
(the `secrets-generation` template label, `modules/gcp-env/secrets.tf`): Cloud Run reads `:latest`
only when an instance starts, so without it warm instances would keep the old value.

**Suspected leak?** Don't rotate key by key: `rotate.ps1 <env>` does all of it, in the right order,
and proves the result. The runbook is `INCIDENTS.md`.

A value changed in the file **without** a counter bump is inert, because Terraform cannot see a
write-only value. The scripts always bump. Edit the JSON by hand only if you bump the counter too.

⚠️ `encryption_key` is never rotated while the environment holds data: every `*_kms` column becomes
unreadable. The scripts refuse unless given `-IUnderstandEncryptionKeyLoss`.

⚠️ **Terraform cannot detect drift on a write-only value.** A version added with `gcloud` is
invisible to it. That is the trade for values never touching state.

**Adding a secret:** one entry in `secrets.tf` + the key in `templates/env.example.json`. The next
script run adds the key (empty) to each environment's file, and `tf.ps1` then refuses to plan until
it is filled.

---

## The runtime environment contract

`--set-env-vars` and `--set-secrets` **replace** rather than merge, and both Terraform and Cloud
Build set them. They are one list: `modules/gcp-env/locals.tf` computes `_SET_ENV_VARS` and
`_SET_SECRETS`, the trigger receives them as substitutions, and `ozari-api/cloudbuild.yaml` forwards
them verbatim. **Never expand them into a literal list in the YAML.** A plain runtime variable is one
line in `locals.tf`.

---

## Database roles

`neon.ps1` creates or rotates two roles with SQL: **`ozari_migrator`** owns the schema (Prisma
migrations, the seed) without server powers, and **`ozari_api`** is DML only, with no DDL, no
ownership and no group memberships. The owner/DBA login is used in memory and never stored.
`db-bootstrap.mjs` then verifies both, and **the script fails** before saving anything if either holds
more than its job needs. The migrator's default privileges give the app every table a future migration
creates, so no re-run is needed. Who can do what: `DEPLOYMENT.md` §3. Re-check any time (read-only):

```powershell
./infrastructure/scripts/neon.ps1 staging -VerifyOnly
```

⚠️ **The role is SQL, not an API call or a Terraform resource.** A role created through the Neon
Console, API, CLI or the community Terraform provider is automatically granted `neon_superuser`
(CREATEDB, CREATEROLE, full DDL). Such a role looks normal and works perfectly. The verification's
group-membership check is what catches it. The Neon **project** is created through the CLI, since a
project has no such problem.

---

## Console edits are emergency-only

Terraform is the source of truth for everything it declares. A manual change in a console shows up as
drift on the next `plan` and is **reverted** by the next `apply`. Edit in a console only to recover
from an outage, then fold the change back into code.

⚠️ **The domain and the zone are never managed.** There is no `cloudflare_zone` or registrar resource
in this repo, and none may be added. Terraform owns the records *inside* the zone, never the zone.
