# Ozari Infrastructure (Terraform)

Infrastructure-as-Code for every Ozari environment. **The plan, the automation map and the reasoning
live in [`INFRASTRUCTURE-PLAN.md`](../INFRASTRUCTURE-PLAN.md) at the repo root** — read that first if
you are asking *what is automated and what isn't*. This file is the operating manual: how to run it.

> **Public repo safety.** This directory must never contain secret values, service-account key JSON,
> or Terraform state. All of those are gitignored. Every file with real values has a committed
> `.example` beside it holding the same keys and no values.

---

## Layout

```
infrastructure/
  bootstrap/                  create-tfstate-bucket.ps1 | .sh   (the only pre-Terraform step)
  scripts/
    tf.ps1                    plan/apply for any environment + stack
    new-secrets.ps1           generate JWT / encryption / API key material
    db-bootstrap.ps1 | .sh    create or rotate the least-privileged database role
    db-roles.sql              the grants it applies
    db-verify.sql             proves the role cannot do DDL (non-zero exit if it can)
  terraform/
    bootstrap/                creates a GCP project + its state bucket        (state: ozari/bootstrap)
    modules/
      gcp-env/                every Google Cloud resource an environment needs
      cloudflare-env/         DNS, the edge Worker, Pages, R2, zone settings
    envs/
      staging/gcp/            inputs only                                     (state: ozari/staging)
      staging/cloudflare/     inputs only                        (state: ozari/staging-cloudflare)
      prod/gcp/               inputs only                                        (state: ozari/prod)
      prod/cloudflare/        inputs only                           (state: ozari/prod-cloudflare)
```

**An environment is a set of inputs, not a copy of the code.** Everything real lives in `modules/`.
If production ever needs something staging does not have, it goes into the module behind a variable —
never as a file that exists in one environment only, because a file that exists in one environment
only is a file nobody tests until the day it matters.

**GCP and Cloudflare are separate roots** with separate states: different credentials, different
blast radius. The one value that crosses (the `run.app` hostname the Worker proxies to) is read from
the GCP root's state, not copied by hand.

---

## Prerequisites

- **Terraform >= 1.11.** Not a preference: `secret_data_wo` (write-only arguments) is what lets
  Terraform own secret values without persisting them, and on an older Terraform the config does not
  merely warn — it fails to parse. `tf.ps1` checks this before doing anything.
- **gcloud**, authenticated for Terraform:
  ```sh
  gcloud auth login
  gcloud auth application-default login   # this is what the provider actually uses
  ```
- **A Cloudflare API token**, for the cloudflare stacks only:
  ```powershell
  $env:CLOUDFLARE_API_TOKEN = "..."
  ```
  ⚠️ An environment variable, never a tfvars value — a token passed as a provider argument is written
  into state. Scopes: Zone → DNS:Edit, Zone Settings:Edit, Workers Routes:Edit; Account → Workers
  Scripts:Edit, Cloudflare Pages:Edit, Workers R2 Storage:Edit.
- **psql or Docker**, for the database scripts. `db-bootstrap` falls back to `postgres:17-alpine` in
  Docker, so there is nothing to install on Windows.

⚠️ **Every `.ps1` in `scripts/` must be saved as UTF-8 WITH a BOM.** Windows PowerShell 5.1 reads a
BOM-less file as ANSI, so the `⚠`, `—` and `·` characters in these scripts become mojibake and can
break tokenization outright — the script fails to parse with an error pointing at a line that looks
perfectly fine. (PowerShell 7 reads UTF-8 by default and hides the problem, which is why it is worth
writing down.) The `.sh` and `.sql` files must NOT have one: a BOM ahead of `#!/usr/bin/env bash`
stops it being a shebang, and psql sends it as part of the first statement.

---

## Everyday commands

```powershell
./scripts/tf.ps1 staging gcp plan
./scripts/tf.ps1 staging gcp apply          # asks you to type the environment name
./scripts/tf.ps1 staging cloudflare plan
./scripts/tf.ps1 prod gcp apply
./scripts/tf.ps1 bootstrap - apply          # one-time: create a new project + state bucket
./scripts/tf.ps1 staging gcp output
```

The wrapper is not sugar; it does four checks that are easy to skip by hand: the Terraform version,
that the environment's `secrets.auto.tfvars` exists before a `gcp apply`, that
`CLOUDFLARE_API_TOKEN` is set before a cloudflare stack, and a typed confirmation before any apply.

**There is no `destroy` verb, deliberately.** Destroying an environment is a documented procedure
(`REBUILD.md` §5), not a flag.

### Before the FIRST Cloudflare apply in any environment

```powershell
$env:CLOUDFLARE_API_TOKEN = "..."
./scripts/cf-import.ps1 -Environment staging        # add -InventoryOnly to look without writing
```

The zone is live. Without this, every object that already exists looks to Terraform like something
to *create*, and the apply dies with "already exists". The script inventories the account, marks each
object **OURS** or **not ours** (the unrelated `qa-ulew` landing page), and writes import blocks for
the OURS rows only — never for anything else. After importing, a plan shows the real differences;
if the live config already matches, the plan is empty and the objects are simply now managed.

⚠️ **The domain and the zone are never managed.** There is no `cloudflare_zone` or registrar resource
in this repo and none may be added: the registration is a purchased, user-facing asset like the
Google OAuth client. Terraform owns the records *inside* the zone, so a destroy removes records — it
cannot remove, transfer or fail to renew the domain.

---

## Setting up an environment's files

Two gitignored files per environment, both with committed examples:

```powershell
cd terraform/envs/staging/gcp
cp terraform.tfvars.example      terraform.tfvars        # non-secret, account-identifying
cp secrets.auto.tfvars.example   secrets.auto.tfvars     # the 11 secret values
```

`*.auto.tfvars` is loaded automatically, so `apply` needs no extra flag. Generate what can be
generated:

```powershell
./scripts/new-secrets.ps1                                        # jwt / encryption / api key
./scripts/db-bootstrap.ps1 -DirectUrl "postgresql://owner:...@ep-xxx.../neondb?sslmode=require"
```

The rest (Resend key, R2 token, Google OAuth client) are minted in their own dashboards — see
`INFRASTRUCTURE-PLAN.md` §3 for the full table of where each value comes from.

---

## Secrets

**Terraform owns the containers, the IAM *and* the versions.** The values reach Secret Manager
through `secret_data_wo`, a Terraform 1.11 write-only argument: the value is sent to the API and then
forgotten. It is never written to `terraform.tfstate` and never appears in a saved plan file.

This replaced a separate `load-secrets-*.ps1` script, and with it a two-phase apply and the standing
chore of destroying superseded versions by hand. **To rotate a secret:**

1. put the new value in `secrets.auto.tfvars`;
2. bump its entry in `secret_version_triggers` (`1` → `2`);
3. apply.

The new version is created and the superseded one is **destroyed in the same operation** — which is
what keeps the Secret Manager bill flat, since it charges for every enabled version forever. The
consequence to know: a rotation is not reversible from Google's side. To roll back, re-apply the
previous value with a further bump.

⚠️ **Terraform cannot detect drift on a write-only value.** If someone adds a version with `gcloud`,
Terraform will neither notice nor correct it. That is the trade for values never touching state; the
counter is the record of intent. Adding a version by hand is a legitimate break-glass move — just
bump the counter afterwards so the two agree.

### Adding a new secret

One entry in `modules/gcp-env/secrets.tf`. It gets its container, version, IAM binding, Cloud Run
env binding and Cloud Build `--set-secrets` entry from that single declaration. Then add the value
to each environment's `secrets.auto.tfvars` and to both `.example` files.

---

## The runtime environment contract

`--set-env-vars` and `--set-secrets` **replace** rather than merge, and both Terraform and Cloud
Build set them. When each kept its own hand-written copy of the list, adding a variable to one
silently wiped it from the service on the other's next run.

They are now one list. `modules/gcp-env/locals.tf` computes `_SET_ENV_VARS` and `_SET_SECRETS` and
passes them to the trigger as substitutions; `ozari-api/cloudbuild.yaml` forwards them verbatim and
enumerates nothing. **Do not expand them back into a literal list in the YAML.**

To add a plain runtime variable: one line in `locals.tf`'s `runtime_env_vars`. Everything else
follows. (Settings that do not vary per environment are not env vars at all — they belong in
`ozari-api/src/config/app.ts` as code preferences.)

---

## Database roles

```powershell
./scripts/db-bootstrap.ps1 -DirectUrl "<owner connection string>"
```

Creates or rotates `ozari_api`: DML only, no DDL, no ownership, no group memberships. Then runs
`db-verify.sql`, which **fails the script** if the result is not actually least-privileged.

⚠️ **This is a script and not a Terraform resource for a specific reason.** A role created through
the Neon Console, API, CLI or the community Terraform provider is automatically granted
`neon_superuser` — CREATEDB, CREATEROLE, full DDL. The provider therefore cannot express the role
this application needs, and a role that can drop your tables looks completely normal in the dashboard
and works perfectly. `db-verify.sql`'s group-membership check is what catches it.

Run the verify on its own any time; it is read-only:

```powershell
psql "$DIRECT_DATABASE_URL" -v app_role=ozari_api -f scripts/db-verify.sql
```

---

## Console edits are emergency-only

Terraform is the source of truth for everything it declares. A manual change in the Google Cloud or
Cloudflare console will be detected as drift by the next `plan` and **reverted** by the next `apply`.
Edit in a console only to recover from an outage, then fold the change back into code immediately.

---

## ⚠️ `terraform destroy` is dangerous

Against a `gcp` root it removes the Cloud Run service, the Artifact Registry repository and its
images, the build trigger, the secret containers **and their versions**, and the service accounts.
Against a `cloudflare` root it removes DNS records, the Worker and the R2 bucket. There is no helper
script for it, on purpose. The deliberate procedure is `INFRASTRUCTURE-PLAN.md` §8, which also lists
what is irrecoverably lost.
