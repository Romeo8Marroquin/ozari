# Staging environment (Terraform)

Adopts and manages the **existing** Ozari staging infrastructure in GCP project
`ozari-500103` (project number `694756660984`), region `northamerica-south1`.

> The Cloud Run service is named **`ozari-api`** even though this is staging. It is
> **not** renamed to `ozari-api-staging` in this adoption pass.

## Files

| File | Purpose |
|---|---|
| `versions.tf` | Terraform + `hashicorp/google` provider version constraints |
| `backend.tf` | GCS remote state (`ozari-500103-tfstate`, prefix `ozari/staging`) |
| `provider.tf` | Google provider (project/region from vars) |
| `variables.tf` | Input variables (defaulted to current staging reality) |
| `terraform.tfvars.example` | Copy to `terraform.tfvars` (gitignored) and adjust |
| `apis.tf` | Enables required service APIs (idempotent, `disable_on_destroy = false`) |
| `service-accounts.tf` | `ozari-run-sa`, `ozari-build-sa` |
| `artifact-registry.tf` | `ozari-images` Docker repo |
| `secrets.tf` | 6 Secret Manager **containers** (no versions/payloads) |
| `iam.tf` | Secret accessor IAM + narrow project IAM for build SA |
| `cloud-run.tf` | `ozari-api` service (v2) + public invoker |
| `cloud-build.tf` | `ozari-api-dev` trigger |
| `outputs.tf` | Useful outputs (URL, SA emails, trigger id, …) |
| `imports.tf` | Terraform 1.5+ import blocks adopting existing resources |

## Quick start

```sh
gcloud auth application-default login
gcloud config set project ozari-500103

terraform init
terraform validate
terraform plan        # review the import/adoption plan — DO NOT apply blindly
# terraform apply     # ONLY after human review/approval
```

Or use the repo helpers from `infrastructure/`:
`./scripts/plan-staging.ps1` and `./scripts/apply-staging.ps1`.

## What to expect on the first `plan`

- **Imports** for: both service accounts, the Artifact Registry repo, all 6 secret
  containers, the Cloud Run service, and the build trigger (see `imports.tf`).
- **"To create"** for additive IAM members (`*_iam_member`) and `google_project_service`
  toggles — these are idempotent and safe (they re-assert existing state).
- Review any **in-place updates** (e.g. SA `display_name`) and reconcile if undesired.
- **Watch for replace/destroy** on imported resources — investigate before applying.
- Cloud Run **secret references** may render as short ids vs
  `projects/<number>/secrets/<name>` due to provider normalization; reconcile if a
  persistent diff appears.

## Notes

- Variables are **defaulted** to staging values so `plan` works without a
  `terraform.tfvars`. The real `terraform.tfvars` is gitignored; use
  `terraform.tfvars.example` as a template.
- Terraform **ignores the Cloud Run container image tag** — Cloud Build owns it.
- Secret **values** are loaded separately; see `infrastructure/scripts/load-secrets-staging.*`.
- See `infrastructure/README.md` for the full workflow, cleanup candidates, and the
  production-future plan.
