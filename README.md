# Ozari

📘 **¿Va a usar la aplicación?** El [**Manual de Party Rentals**](./MANUAL.md) explica cada flujo —
catálogo, pedidos, entregas, cobros, documentos y calendarios— con lo esencial arriba y el detalle
desplegable.

Cloud-ready operations platform for a party-rentals business: product catalog and inventory today;
orders, availability and delivery logistics next (see Planning below).

**Status**: deployed and operational on the `dev` branch (staging). The production `main` branch
will be created after MVP completion.

## Architecture

A monorepo with two **independently managed pnpm workspaces** (there is no root `package.json` —
each package has its own lockfile and `node_modules`; always `cd` into the package before running
`pnpm`):

- **ozari-api** — backend API (Express 5, Prisma 7, PostgreSQL)
- **ozari-app** — frontend application (React 19, Vite, TanStack Router)

Supporting directories:

- **infrastructure/** — Terraform for the staging GCP footprint plus operational scripts
- **ozari-api/prisma/** — schema, migrations, and the idempotent reference-data seed

## Tech stack

| Layer      | Technology |
|------------|------------|
| Frontend   | React 19, Vite, TanStack Router + React Query 5, react-hook-form 7 + Zod 4, Tailwind 4, GSAP, i18next |
| Backend    | Node.js 22 (ESM), Express 5, Zod 4, jsonwebtoken 9, helmet 8, winston 3, i18next |
| Database   | PostgreSQL 17 (Neon) via Prisma 7 (pooled URL at runtime, direct URL for migrations) |
| Storage    | Cloudflare R2 (public product images; browser uploads via presigned PUT URLs) |
| Email      | Resend (verified domain `partyrentalsgt.com`, branded templates) |
| Tooling    | pnpm 11, TypeScript 6, ESLint 10, Vitest 4 (both packages enforce 100% test coverage) |

## Infrastructure

Backend deploys to **Google Cloud Run** through **Cloud Build**; the frontend deploys to
**Cloudflare Pages**; the database is **Neon PostgreSQL**; product images live in **Cloudflare R2**;
transactional email goes through **Resend**.

- **Terraform** (`infrastructure/terraform/envs/staging/`, GCS state backend) owns the staging GCP
  footprint: the Cloud Run service's structural config, Artifact Registry, the Cloud Build trigger
  and its substitutions, both service accounts, the Secret Manager containers + IAM (never secret
  values), and narrow project IAM. Cloud Build owns the container image tag. Console edits are
  emergency-only; `terraform plan` detects drift. Full ownership rules: `infrastructure/README.md`.
- **Staging shape**: project `ozari-500103`, region `northamerica-south1`, service `ozari-api`
  (port 8080, min 0 / max 3 instances, concurrency 40, 1 CPU / 512 Mi). Plain env vars are only
  `NODE_ENV`, `LOG_LEVEL`, `APP_HOST`; everything else comes from Secret Manager.
- **Secrets** (Secret Manager, loaded out-of-band by `infrastructure/scripts/load-secrets-staging.*`):
  database URLs (pooled + direct), JWT secrets, encryption key, API key, Resend key. Never in
  Terraform, never committed.
- **CI/CD**: the Cloud Build trigger (`ozari-api/cloudbuild.yaml`) verifies (install, build,
  type-check), builds and pushes the Docker image, runs `prisma migrate deploy` against the direct
  URL, then deploys to Cloud Run. Cloudflare Pages builds the frontend on pushes to `dev`
  (`VITE_API_URL` is set manually in Cloudflare, not by Terraform).

The ordered from-zero runbook (Neon, secrets, Terraform, Cloud Build, Cloud Run, Cloudflare,
Resend, R2 CORS, production cutover plan, DB role model, migration-squash strategy) is
**[DEPLOYMENT.md](./DEPLOYMENT.md)**.

## Backend (`ozari-api`)

Express 5 API with strict module layering (`route → validator → controller → Prisma`), centralized
response envelopes, and es-GT i18n for all user-facing strings. Security chain: helmet CSP, tiered
rate limiting, strict CORS, API-key/origin validation, request-ID tracing, JWT sessions persisted
in the database (revocable; refresh rotation with reuse detection), CSRF double-submit, AES-256-GCM
encryption for PII at rest, TOTP two-factor auth, and audit logging in deployed environments. The
OpenAPI spec is hand-authored and served at `/api/docs` outside production; a structural test keeps
it in sync with the mounted routes. Local ops scripts (session cleanup, the R2/DB image reconcile)
live alongside and never deploy. Details, endpoint tables, and script usage:
**[ozari-api/README.md](./ozari-api/README.md)**.

## Frontend (`ozari-app`)

React 19 panel application with file-based routing (TanStack Router), React Query for server
state, role-gated UI over backend-enforced roles, and a deliberate motion system (GSAP page
transitions, shared-element image morphs, skeleton-to-content reveals, per-page scroll memory).
Auth mirrors the backend contract: silent token refresh, forced-logout choreography, outage
overlay with health polling, and mirrored Zod validation. Details:
**[ozari-app/README.md](./ozari-app/README.md)**.

## Planning

Work is organized in epics; each epic file is the deep plan and decision record for its module.

| Document | Scope | Status |
|----------|-------|--------|
| [ROADMAP.md](./ROADMAP.md) | Cross-epic compass and the standing quality bar | living |
| [EPIC-1-INVENTORY.md](./EPIC-1-INVENTORY.md) | Product catalog + inventory (roles, pricing, gallery, CRUD) | **completed** — kept as the decision record |
| [EPIC-2-ORDERS.md](./EPIC-2-ORDERS.md) | Orders, period availability, delivery logistics, receipts, calendar | in progress (EPIC-2A, the Employee→Driver role refactor, is **done**; orders themselves are next) |

Completed epics are retained, not deleted: they document the owner decisions and architectural
patterns later modules inherit, and `CLAUDE.md` and the epic files cross-reference each other.

## Prerequisites

- Node.js >= 22
- pnpm >= 10 (repo pinned to 11.x via `packageManager`; use `pnpm` only — never `npm`/`npx`)

## Quick start

```bash
# Backend (terminal 1) — copy ozari-api/.env.example to .env first
cd ozari-api
pnpm install
pnpm exec prisma generate
pnpm prisma:migrate:deploy   # apply pending migrations to your local/dev DB
pnpm db:seed                 # once per fresh database (reference data)
pnpm dev                     # http://localhost:3000

# Frontend (terminal 2) — copy ozari-app/.env.example to .env first
cd ozari-app
pnpm install
pnpm dev                     # http://localhost:5173 (proxies /api to :3000)
```

## Quality bar

Both packages enforce **100% test coverage** (statements, branches, functions, lines) in CI-style
runs, plus clean `tsc --noEmit` and ESLint. Any endpoint change ships with its tests and its
OpenAPI documentation in the same commit.

## Repository structure

```
ozari/
├── ozari-api/            # Backend API (own pnpm workspace)
│   ├── src/              # Modules, middleware, config, helpers, docs (OpenAPI)
│   ├── prisma/           # Schema, migrations, seed
│   ├── scripts/          # Local-only ops scripts (never deployed)
│   └── README.md
├── ozari-app/            # Frontend application (own pnpm workspace)
│   ├── src/              # Routes, modules, components, utils
│   └── README.md
├── infrastructure/       # Terraform (staging) + operational scripts
│   └── README.md         # Terraform ownership rules
├── DEPLOYMENT.md         # From-zero deployment runbook
├── ROADMAP.md            # Cross-epic compass
├── EPIC-1-INVENTORY.md   # Epic 1 plan + decisions (completed)
├── EPIC-2-ORDERS.md      # Epic 2 plan + owner decisions (next)
├── CLAUDE.md             # Assistant/project operation notes
└── README.md             # This file
```

## License

Proprietary
