# Ozari API

Modern Express TypeScript API for the Ozari platform.

**Status**: ✅ Deployed on Google Cloud Run (staging environment)

## Features

- **Express.js** - Fast, unopinionated web framework
- **TypeScript** - Type-safe development with strict mode
- **Prisma** - Modern ORM with PostgreSQL
- **JWT Authentication** - Secure token-based auth with refresh tokens
- **Role-Based Access Control** - Admin, Employee, Client roles
- **AES-256-GCM Encryption** - Encrypted sensitive data (KMS fields)
- **Winston Logger** - Structured logging with request context
- **i18n Support** - Spanish (Guatemala) translations
- **Security** - Helmet, CORS, API key validation
- **AsyncLocalStorage** - Request context tracking

## Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 9.0.0
- **PostgreSQL** database (Neon or local)

## Quick Start

### 1. Install Dependencies

```bash
cd ozari-api
pnpm install
```

### 2. Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Generate secrets:

```bash
# JWT secrets
openssl rand -hex 32

# Encryption key (32 bytes)
openssl rand -hex 32

# API key
openssl rand -hex 32
```

### 3. Database Setup

```bash
# Generate Prisma Client
pnpm run prisma:generate

# Run migrations
pnpm run prisma:dev

# (Optional) Open Prisma Studio
pnpm run prisma:studio
```

### 4. Development

```bash
# Start dev server with hot reload
pnpm run dev

# Start with debugger
pnpm run dev:debug

# Type checking
pnpm run type-check

# Linting
pnpm run lint
pnpm run lint:fix

# Testing
pnpm test                # Run all tests
pnpm run test:unit       # Run unit tests only
pnpm run test:integration # Run integration tests only
pnpm run test:coverage   # Run with coverage (requires 100%)
pnpm run test:ci         # CI pipeline (unit + integration)
```

### 5. Production Build

```bash
# Build TypeScript
pnpm run build

# Start production server
pnpm start
```

## Project Structure

```
src/
├── config/              # Configuration files
│   ├── app.ts          # App constants
│   ├── context.ts      # AsyncLocalStorage
│   ├── i18n.ts         # Internationalization
│   └── logger.ts       # Winston logger
├── helpers/            # Utility functions
│   ├── encryption.ts   # AES-256-GCM, bcrypt, SHA-256
│   ├── regex.ts        # Validation patterns
│   └── utils.ts        # General utilities
├── middlewares/        # Express middlewares
│   ├── apiKey.middleware.ts    # API key validation
│   ├── auth.middleware.ts      # JWT verification
│   └── role.middleware.ts      # Role-based access
├── models/             # TypeScript models
│   ├── common/         # Shared models
│   ├── enums/          # Enumerations
│   └── http/           # HTTP response models
├── modules/            # Feature modules
│   ├── auth/          # Authentication
│   ├── health/        # Health check
│   └── products/      # Planned products module (not mounted yet)
├── services/          # Business services
│   └── prisma.service.ts  # Prisma client singleton
├── locales/           # i18n translations
│   └── es-GT/
│       └── translation.json
├── app.ts             # Express app setup
└── index.ts           # Server entry point
```

## API Endpoints

### Health

- `GET /api/health/check` - Health check (public)

### Authentication

- `POST /api/auth/user` - Create user (public)
- `POST /api/auth/signin` - Sign in (public)
- `POST /api/auth/refresh` - Refresh token (public)
- `POST /api/auth/signout` - Sign out (protected)
- `GET /api/auth/all` - Get all users (admin only)

### Products

Product endpoints are planned but not currently mounted.

## Authentication

Server-to-server requests without a browser `Origin` header require `x-api-key`:

```bash
# Local development
curl -H "x-api-key: your-api-key" http://localhost:3000/api/health/check

# Staging/production
curl -H "x-api-key: your-api-key" <your-cloud-run-url>/api/health/check
```

Protected endpoints also require a JWT access token. State-changing browser requests include CSRF protection through the `csrf-token` cookie and `x-csrf-token` header.

```bash
curl -H "x-api-key: your-api-key" \
     -H "Authorization: Bearer <access-token>" \
     http://localhost:3000/api/auth/all
```

Browser requests are restricted by CORS and authenticated with JWT/CSRF where required. Do not expose `API_KEY` in frontend environment variables.

## Environment Variables

Only values that genuinely vary per environment (or are secret) are env vars. Settings
that are the same across environments live in code as preferences (e.g. the API base
path and all TOTP/MFA parameters in `src/config/app.ts` → `appConfig`); change those in
code and redeploy, not via env vars.

| Variable | Description | Required |
|----------|-------------|----------|
| `NODE_ENV` | Single environment switch + runtime mode (`development`, `staging`, `production`) | No (default: `development`) |
| `API_HOST` | Server host. Local defaults to `localhost`; Cloud Run/deployed defaults to `0.0.0.0` | No |
| `PORT` | Server port. Local defaults to `3000`; Cloud Run injects `PORT` (`8080`) | No |
| `APP_HOST` | Frontend URL for CORS + API-key browser-origin check (no trailing slash) | Yes |
| `DATABASE_URL` | PostgreSQL connection string (Neon **pooled** URL at runtime) | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `JWT_REFRESH_SECRET` | Refresh token secret | Yes |
| `ENCRYPTION_KEY` | AES-256 encryption key (hex) | Yes |
| `API_KEY` | API authentication key | Yes |
| `LOG_LEVEL` | Winston log level | No (default: info) |

> **Removed (June 2026 cleanup):** `APP_ENV` (redundant — `NODE_ENV` is the only
> environment switch; `NODE_ENV=staging` already distinguishes staging) and
> `API_BASE_PATH` (was never read; the base path is the code preference
> `appConfig.basePath`).

## Deployment

### Google Cloud Run

**Status**: ✅ Staging deployment configured through Cloud Build

The backend is deployed as a normal container on Google Cloud Run. The Cloud Build trigger uses `ozari-api/cloudbuild.yaml`; because this repository is a monorepo, API build steps use `dir: ozari-api` and Docker builds with `ozari-api` as the context.

**Staging Configuration**:
- **Google Cloud project**: `ozari-500103`
- **Region**: `northamerica-south1`
- **Cloud Run service**: `ozari-api` (this is the staging service; not renamed)
- **Artifact Registry repository**: `ozari-images`
- **Runtime service account**: `ozari-run-sa@ozari-500103.iam.gserviceaccount.com`
- **Cloud Build config**: `ozari-api/cloudbuild.yaml`
- **Docker context**: `ozari-api`
- **Runtime command**: `pnpm start`
- **Container port**: `8080`
- **Scaling**: `--min-instances=0`, `--max-instances=3`

**Pipeline Flow**:
1. `verify-api`: install dependencies, run `pnpm build`, run `pnpm type-check`.
2. `build-docker-image`: build the Docker image from the `ozari-api` directory.
3. `push-docker-image`: push `$COMMIT_SHA` and `latest` tags to Artifact Registry.
4. `apply-prisma-migrations`: run `pnpm prisma:migrate:deploy` once inside the built image.
5. `deploy-cloud-run`: deploy the exact built image to Cloud Run.

**Prisma and Neon URLs**:
- Cloud Run runtime uses the Neon pooled URL as `DATABASE_URL`.
- The migration step uses the Neon direct URL secret, expanded as `DATABASE_URL` only inside the migration container.
- `DIRECT_DATABASE_URL` is not passed to the Cloud Run runtime.
- `prisma migrate deploy` is safe to run every deployment; if there are no pending migrations, it is a no-op.
- Do not put `prisma migrate deploy` in `start`, because Cloud Run may start multiple instances.

**Required Secret Manager Secrets**:

| Secret | Purpose |
|--------|---------|
| `ozari-database-url` | Neon pooled URL for Cloud Run runtime |
| `ozari-direct-database-url` | Neon direct URL for Prisma migrations |
| `ozari-jwt-secret` | JWT access token signing secret |
| `ozari-jwt-refresh-secret` | JWT refresh token signing secret |
| `ozari-encryption-key` | AES-256 encryption key |
| `ozari-api-key` | Server-to-server API key |

**Runtime Environment Variables**:

These are set by `cloudbuild.yaml` during `gcloud run deploy`:

```bash
NODE_ENV=staging
LOG_LEVEL=info
APP_HOST=<cloudflare-frontend-url>
DATABASE_URL=<from Secret Manager: ozari-database-url>
JWT_SECRET=<from Secret Manager: ozari-jwt-secret>
JWT_REFRESH_SECRET=<from Secret Manager: ozari-jwt-refresh-secret>
ENCRYPTION_KEY=<from Secret Manager: ozari-encryption-key>
API_KEY=<from Secret Manager: ozari-api-key>
```

`APP_HOST` is a Cloud Build substitution. Keep the repository value as a placeholder and configure the real Cloudflare URL in the Cloud Build trigger or manual substitution.

Use the frontend origin only, without a trailing slash or route path, so CORS can compare browser origins exactly.
For Cloud Run, configure this value through Cloud Build substitutions rather than hardcoding environment-specific URLs in the repository.

**Cloud Build Trigger Setup**:
1. Connect the repository to Cloud Build.
2. Configure the trigger to use `/ozari-api/cloudbuild.yaml`.
3. Configure substitutions for environment-specific values, especially `_APP_HOST`.
4. Ensure the Cloud Build service account can read the required Secret Manager secrets, push Artifact Registry images, and deploy Cloud Run.
5. Ensure the Cloud Run runtime service account can access runtime secrets.

**Health Check**:
```bash
curl <your-cloud-run-url>/api/health/check
```

The health endpoint verifies both the HTTP service and database connectivity, so a failure usually means the runtime database secret or Neon connectivity should be checked first.

### Docker

The Dockerfile uses `node:22-bookworm-slim`, not Alpine, to avoid Prisma/OpenSSL compatibility issues. It copies `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` before `pnpm install --frozen-lockfile`; the workspace file is required because pnpm overrides are stored there.

Local Docker test from the monorepo root:

```bash
docker build -t ozari-api-test ./ozari-api
docker run --rm --env-file ozari-api/.env -p 8080:8080 ozari-api-test
curl http://localhost:8080/api/health/check
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start dev server with hot reload |
| `pnpm run dev:debug` | Start with Node debugger |
| `pnpm run build` | Build TypeScript to dist/ |
| `pnpm start` | Start production server |
| `pnpm run prisma:generate` | Generate Prisma Client |
| `pnpm run prisma:dev` | Run database migrations (development) |
| `pnpm run prisma:migrate:deploy` | Deploy migrations in staging/production CI/CD |
| `pnpm run prisma:deploy` | Alias for `pnpm run prisma:migrate:deploy` |
| `pnpm run prisma:studio` | Open Prisma Studio |
| `pnpm run db:seed` | Seed reference data (idempotent; see below) |
| `pnpm run cleanup:sessions` | Delete expired JWT sessions (see below) |
| `pnpm run lint` | Run ESLint |
| `pnpm run lint:fix` | Fix ESLint errors |
| `pnpm run type-check` | Check TypeScript types |

### Database seeding

`pnpm run db:seed` (`prisma db seed` → `prisma/seed.ts`) loads the **reference data**
the app depends on: `user_roles` (Client/Admin/Employee), `token_types`
(Access/Refresh), currencies, geography (Guatemala → department → municipality →
zones), product categories, statuses, etc. Without it, **register and login fail** on
foreign-key constraints (`roleId` → `user_roles`, `tokenTypeId` → `token_types`).

- The seed is **idempotent** — it upserts by primary key, so running it against an
  already-seeded DB updates in place and never duplicates. It also resets the serial
  sequences so a fresh DB won't collide on the next insert.
- It is **not** part of `prisma migrate deploy` — deploying never runs it. Run it
  **once per fresh environment** (e.g. a new prod DB). Staging is already seeded.
- It contains reference data only — no users, secrets, or PII.

### Session cleanup

Token rotation **hard-deletes** old session rows, so active users never accumulate
garbage. The only rows that linger are **expired** sessions from abandoned logins
(someone signs in once and never returns). `pnpm run cleanup:sessions` reaps rows where
`expiresAt <= now`.

- This is a **standalone script**, not an HTTP route. With Cloud Run at
  `min-instances=0` it does **not** run automatically (nothing triggers it on request).
- For the current scale, run it manually/occasionally — the garbage is negligible.
- When it matters, schedule it with **Cloud Scheduler → a Cloud Run Job** (a Job is
  separate from the service and bills only for its runtime). Not wired up yet.

## Technologies

- **Express** 4.21.2 - Web framework
- **TypeScript** 5.7.2 - Type safety
- **Prisma** 6.1.0 - Database ORM
- **PostgreSQL** - Primary database
- **JWT** - jsonwebtoken 9.0.2
- **bcrypt** 5.1.1 - Password hashing
- **Winston** 3.17.0 - Logging
- **i18next** 24.2.0 - Internationalization
- **Helmet** 8.0.0 - Security headers
- **CORS** 2.8.5 - Cross-origin resource sharing
- **Zod** 3.24.1 - Runtime validation
- **tsx** 4.19.2 - TypeScript execution

## License

MIT
