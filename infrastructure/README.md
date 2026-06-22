# Ozari Infrastructure (Terraform)

Infrastructure-as-Code for Ozari's **existing** GCP **staging** environment. This is a
first **adoption** pass: Terraform is wired to *import* and then own the resources that
already exist — it does **not** create a new environment from scratch.

> **Public repo safety:** this directory must never contain secret values, service
> account key JSON, or Terraform state. Those are gitignored (see root `.gitignore`).
> Terraform manages secret **containers and IAM only**, never secret **payloads**.

## Layout

```
infrastructure/
  README.md                     # this file
  bootstrap/                    # one-time / idempotent state-bucket setup
    create-tfstate-bucket.ps1
    create-tfstate-bucket.sh
  terraform/
    envs/
      staging/                  # the staging environment (see its own README.md)
  secrets/                      # LOCAL, gitignored secret material (only .gitkeep tracked)
  scripts/                      # plan/apply/load-secrets helpers (ps1 + sh)
```

## Prerequisites

- **Terraform >= 1.5** (import blocks are used; 1.5+ required). Check: `terraform version`.
- **gcloud CLI** authenticated:
  ```sh
  gcloud auth login
  gcloud auth application-default login
  gcloud config set project ozari-500103
  ```
  `application-default login` is what the Terraform Google provider uses (ADC).

## State bucket

Remote state lives in a **pre-existing** GCS bucket:

```
bucket = ozari-500103-tfstate
prefix = ozari/staging
```

The bucket already exists — you do **not** need to create it. The bootstrap scripts are
**idempotent** and safe to re-run; they only verify the bucket and ensure versioning:

```powershell
# PowerShell
./bootstrap/create-tfstate-bucket.ps1
```
```sh
# bash
./bootstrap/create-tfstate-bucket.sh
```

## Adoption workflow

Do this from `infrastructure/terraform/envs/staging/` (or use the helper scripts).

1. **Check the state bucket** (idempotent): run a bootstrap script above.
2. **`terraform init`** — initializes the GCS backend + downloads the provider.
3. **`terraform validate`** — config sanity check.
4. **`terraform plan`** — with `imports.tf` present, this shows the **import/adoption**
   plan for existing resources plus any config drift.
5. **Review the import/adoption plan carefully.** Expect: imports of the SA(s), Artifact
   Registry repo, 6 secrets, Cloud Run service, and the build trigger; "create" lines
   for additive IAM members (safe — they just re-assert existing membership). Watch for
   unexpected **replace/destroy** lines and for secret-reference normalization diffs on
   Cloud Run (short id vs `projects/<number>/secrets/<name>`).
6. **`terraform apply` — only after human approval.** Use `./scripts/apply-staging.ps1`
   (it requires you to type `apply staging`).
7. **`terraform plan` again** — it should now be clean (no changes), confirming the
   state matches reality.

Helper scripts:

```powershell
./scripts/plan-staging.ps1     # init + validate + plan (read-only)
./scripts/apply-staging.ps1    # init + apply, with explicit confirmation
```

## Secrets are loaded separately (and gitignored)

Terraform owns secret **containers** + **IAM**. The actual values are pushed as Secret
Manager **versions** out-of-band, from a local gitignored file
(`infrastructure/secrets/staging.env`), using:

```powershell
./scripts/load-secrets-staging.ps1
```
```sh
./scripts/load-secrets-staging.sh
```

These scripts contain **no** secret values; they read `KEY=VALUE` lines from the local
file and `gcloud secrets versions add` each one. The app reads `:latest`.

## ⚠️ `terraform destroy` is dangerous

`terraform destroy` against this config can **remove the Cloud Run service, Artifact
Registry repository, the Cloud Build trigger, the Secret Manager secret containers, and
the service accounts** — i.e. it can take down staging and delete secret containers.
Never run it casually. There is no destroy helper script on purpose.

## Old / unused resources — cleanup candidates (NOT managed here)

These are intentionally left **unmanaged** in this first pass; review and clean up later:

- **`neon-database-url`** — old/unused secret. Cleanup candidate.
- **`neon-direct-url`** — old/unused secret. Cleanup candidate.
- **Default compute service account has `roles/editor`** — over-privileged; scope down.
- **Cloud Build service agent has `roles/secretmanager.admin`** — scope down to
  `secretAccessor` on specific secrets.
- **Cloud Run timeout is 300s** — kept for adoption; can be reduced later.
- **Artifact Registry vulnerability scanning is disabled** — consider enabling.

## Production (future)

Production does **not** exist yet. When it does, mirror this layout under a separate
env directory and keep everything isolated:

```
infrastructure/terraform/envs/prod/
```

- Ideally a **separate GCP project** (hard isolation from staging).
- **Separate secrets**, **separate Cloud Build trigger**, and a **separate state
  prefix/bucket** (e.g. prefix `ozari/prod`).

## Hardening TODOs (tracked, not done in this pass)

See the cleanup candidates above plus inline `TODO` comments in `iam.tf`,
`cloud-run.tf`, `cloud-build.tf`, and `ozari-api/cloudbuild.yaml`.
