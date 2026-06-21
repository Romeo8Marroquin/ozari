# Assistant Notes

This repository is a monorepo:

- `ozari-api/` contains the Express/Prisma backend.
- `ozari-app/` contains the React/Vite frontend.

## Deployment Ownership

- Backend deployments use Google Cloud Build and Cloud Run, not GitHub Actions or Railway.
- Frontend deployments use Cloudflare Pages.
- Do not add GitHub Actions deploy workflows unless explicitly requested.
- Do not run `gcloud builds submit`, deploy commands, commits, or pushes unless explicitly requested.

## Backend Cloud Build

- Cloud Build config: `ozari-api/cloudbuild.yaml`.
- Cloud Build trigger should point to `/ozari-api/cloudbuild.yaml`.
- API-specific Cloud Build steps must use `dir: ozari-api` because the repo root is the monorepo root.
- Docker build context must stay scoped to `ozari-api`.

Staging defaults:

- Project: `ozari-500103`
- Region: `northamerica-south1`
- Cloud Run service: `ozari-api-staging`
- Artifact Registry repository: `ozari-images`
- Runtime service account: `ozari-run-sa@ozari-500103.iam.gserviceaccount.com`
- `NODE_ENV=staging`
- `APP_ENV=staging`

## Prisma and Neon

- Runtime Cloud Run uses the Neon pooled URL as `DATABASE_URL`.
- Cloud Build migrations use the Neon direct URL secret, passed to the migration container as `DATABASE_URL`.
- Do not pass `DIRECT_DATABASE_URL` to Cloud Run runtime.
- Do not put `prisma migrate deploy` in the container start command.
- `pnpm build` runs `prisma generate`; this is expected and does not apply migrations.
- `prisma migrate deploy` should run in CI/CD and is a no-op when no migrations are pending.

## Secrets

Use Secret Manager names:

- `ozari-database-url`
- `ozari-direct-database-url`
- `ozari-jwt-secret`
- `ozari-jwt-refresh-secret`
- `ozari-encryption-key`
- `ozari-api-key`

Never commit real `.env` files, PostgreSQL URLs, JWT secrets, encryption keys, or API keys.

## Local Development

- Local API defaults remain `localhost:3000`.
- Cloud Run/deployed defaults use `0.0.0.0:8080` through environment detection and Cloud Run `PORT`.
- Do not change frontend files when working on backend deployment unless the task explicitly requires it.
