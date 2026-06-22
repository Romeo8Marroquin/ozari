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

## Configuration ownership — what Terraform manages and how to change it

> **Manual Google Cloud Console edits are emergency-only.** Terraform is the source of
> truth for the resources below. If you edit them by hand in the Console, the next
> `terraform plan` will detect the drift and `terraform apply` will **restore the
> declared state** (your manual change will be reverted). Only edit in the Console for
> emergency recovery, then reconcile the change back into this code immediately.

### Cloud Build trigger substitutions are Terraform-managed

The Cloud Build trigger substitutions are now managed by Terraform
(`cloud-build.tf`), **not** edited by hand in the Cloud Console during normal
operation. Managed substitutions:

- `_APP_HOST`
- `_IMAGE_URL`
- `_NODE_ENV`
- `_REGION`
- `_RUN_SA`
- `_SERVICE_NAME`

**To change a substitution:**

1. Edit `infrastructure/terraform/envs/staging/variables.tf` (the value) and/or
   `cloud-build.tf` (the mapping).
2. `terraform plan` and review.
3. `terraform apply` after review.
4. Do **not** change it manually in the Console except for emergency recovery (and then
   fold the change back into Terraform).

### `variables.tf` defaults are the staging source of truth

The defaults in `variables.tf` are the **staging source of truth for all non-secret
configuration**. `terraform.tfvars` is **optional, gitignored, and only for local
overrides** — staging does **not** require a `terraform.tfvars`. Use
`terraform.tfvars.example` as a reference if you choose to create local overrides.

### Cloud Run runtime configuration (env vars)

Cloud Run runtime config is owned by **Terraform** (structural config: scaling,
concurrency, timeout, env vars, secret bindings, SA, ingress) **and** the **Cloud Build
deploy command** (`ozari-api/cloudbuild.yaml`, which sets env vars + image on each
deploy). Because both `terraform apply` and `gcloud run deploy` use `--set-env-vars`
(full replacement), the two **must stay in sync** or they will fight on each run.

**When you add a new runtime env var, update all that apply:**

| File | When |
|---|---|
| `variables.tf` | Always — declare the input (with a staging default). |
| `terraform.tfvars.example` | If you want it documented as an overridable value. |
| `cloud-run.tf` | Always — add the `env { }` (plain) or `value_source` (secret) block. |
| `cloud-build.tf` substitutions | Only if Cloud Build needs to pass the value (managed substitution). |
| `ozari-api/cloudbuild.yaml` deploy command | If Cloud Build sets it on `gcloud run deploy --set-env-vars` — keep this list identical to the env vars Terraform declares. |

> Settings that do **not** vary per environment are **not** env vars — they live in
> code as preferences (`ozari-api/src/config/app.ts` → `appConfig`, e.g. the API base
> path and all TOTP/MFA parameters). Change those in code and redeploy.
>
> **June 2026 cleanup:** `APP_ENV` and `API_BASE_PATH` were removed from the runtime
> env. `APP_ENV` was redundant (`NODE_ENV` is the single environment switch); the API
> base path is the code preference `appConfig.basePath`, not an env var.

### Secret values are NOT managed by Terraform

Terraform manages only the secret **containers** and the **IAM access** to them. Secret
**payloads/versions are never** in Terraform or Git — they live in Secret Manager and
are loaded out-of-band (see `scripts/load-secrets-staging.*`). The app reads `:latest`.

### Cloudflare Pages `VITE_API_URL` is NOT managed by Terraform

The frontend's API URL is still configured **manually in Cloudflare Pages** and is
**not** managed by this Terraform (Terraform here only owns GCP):

```
VITE_API_URL=https://ozari-api-694756660984.northamerica-south1.run.app
```

If the Cloud Run URL changes, update this value in the Cloudflare Pages project
settings by hand.

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
- **Cloud Run timeout** — reduced from 300s to **60s** (backstop above the app's own
  30s request/response timeout). Done.
- **Artifact Registry vulnerability scanning is disabled** — intentionally left off for
  cost (~$0.26 per image scanned ≈ several $/month at this deploy cadence). Dependency
  CVEs are tracked manually via `pnpm audit` instead. Revisit if budget allows.

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
