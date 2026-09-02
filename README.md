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

- **Terraform** (`infrastructure/terraform/`, GCS state backend) owns both clouds. An environment is
  a set of *inputs* to a shared module, not a copied directory: `modules/gcp-env` (Cloud Run,
  Artifact Registry with cleanup policies, Cloud Build connection + trigger, service accounts, IAM,
  Secret Manager containers **and versions**) and `modules/cloudflare-env` (DNS, the edge Worker that
  rewrites `Host` in front of Cloud Run, Pages including `VITE_API_URL`, R2 with its CORS policy,
  zone SSL). GCP and Cloudflare are separate roots with separate states.
- **Staging shape**: project `ozari-500103`, region `northamerica-south1`, service `ozari-api`
  (port 8080, min 0 / max 3 instances, concurrency 40, 1 CPU / 512 Mi). Cloud Build owns the image
  tag; Terraform owns everything structural. Console edits are emergency-only — `plan` detects drift.
- **Secrets** live in Secret Manager and are applied by Terraform through **write-only arguments**,
  so values never enter state or a saved plan. Real values sit in gitignored `secrets.auto.tfvars`
  files with committed `.example` templates. Rotation is a value plus a counter bump, and the
  superseded version is destroyed in the same apply.
- **CI/CD**: the Cloud Build trigger (`ozari-api/cloudbuild.yaml`) verifies (install, build,
  type-check), builds and pushes the Docker image, runs `prisma migrate deploy` against the direct
  URL, then deploys to Cloud Run — with the env and secret lists **computed by Terraform**, so the
  pipeline and the declared service cannot disagree. Cloudflare Pages builds the frontend on `dev`.
- **The database role is a script, not Terraform** (`infrastructure/scripts/db-bootstrap.*`): the
  application connects as a DML-only role that cannot alter the schema, and `db-verify.sql` proves it.

**[INFRASTRUCTURE-PLAN.md](./INFRASTRUCTURE-PLAN.md)** is the automation map — what is code, what is
a click and why, plus the per-environment configuration matrix and the cost model.
**[DEPLOYMENT.md](./DEPLOYMENT.md)** is the ordered from-zero runbook, and
**[REBUILD.md](./REBUILD.md)** is the teardown-and-recreate procedure with the complete list of
manual steps.

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

## Documentation map

`CLAUDE.md` is the always-loaded conventions layer (structure, invariants, tripwires). Everything
deeper lives in a companion doc it points at.

**Reference — what is built and how it must behave:**

| Document | Scope |
|----------|-------|
| [CLAUDE.md](./CLAUDE.md) | Repo conventions, doctrines and the documentation map |
| [MODULES.md](./MODULES.md) | Per-module state of the built product and the rules that live nowhere else |
| [FRONTEND-DOCTRINE.md](./FRONTEND-DOCTRINE.md) | UI doctrine: motion, modals/z-index, forms, responsive layout, tokens |
| [AUTH-AND-SECURITY.md](./AUTH-AND-SECURITY.md) | Auth chain, sessions/rotation, MFA, password reset, throttling, email |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | The deploy runbook (secrets, domains, R2, OAuth, rollout) |
| [INFRASTRUCTURE-PLAN.md](./INFRASTRUCTURE-PLAN.md) | What is automated, what cannot be, the config matrix and the cost model |
| [REBUILD.md](./REBUILD.md) | Erasing and recreating an environment: ownership register, ordered manual steps, teardown |

**Planning — epics are the deep plan and decision record for their module:**

| Document | Scope | Status |
|----------|-------|--------|
| [ROADMAP.md](./ROADMAP.md) | Cross-epic compass and the standing quality bar | living |
| [EPIC-1-INVENTORY.md](./EPIC-1-INVENTORY.md) | Product catalog + inventory (roles, pricing, gallery, CRUD) | **completed** — kept as the decision record |
| [EPIC-2-ORDERS.md](./EPIC-2-ORDERS.md) | Orders, period availability, delivery logistics, client registries | in progress |
| [EPIC-2-ORDER-LIFECYCLE.md](./EPIC-2-ORDER-LIFECYCLE.md) | The data-driven status machine (`advance`, holds, evidence) | built; admin editor deferred |
| [EPIC-2-DRIVER-AVAILABILITY.md](./EPIC-2-DRIVER-AVAILABILITY.md) | The logistics pad — driver spacing, assignment, the `.ics` block | built |
| [EPIC-2-DOCUMENTS.md](./EPIC-2-DOCUMENTS.md) | Cotización + comprobante PDF | built |
| [EPIC-2-CALENDAR.md](./EPIC-2-CALENDAR.md) | Google Calendar API + private ICS subscription | built |

Completed epics are retained, not deleted: they document the owner decisions and architectural
patterns later modules inherit, and the reference docs cross-reference them.

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
