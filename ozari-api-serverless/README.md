# Ozari API

Backend API for the Ozari platform built with Express.js, Prisma, and PostgreSQL.

## Tech Stack

- Runtime: Node.js 22
- Framework: Express.js 5
- Database: PostgreSQL (Neon)
- ORM: Prisma 7
- Deployment: AWS Lambda (Serverless Framework)
- Package Manager: pnpm

## Prerequisites

- Node.js >= 22
- pnpm >= 10
- Neon PostgreSQL database

## Local Development

### Environment Setup

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

2. Configure environment variables in `.env`:
   ```bash
   # Server Configuration
   API_ENV=dev
   API_HOST=localhost
   API_PORT=3000
   APP_HOST=http://localhost:5173

   # Database
   DATABASE_URL="postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require"

   # Security (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
   JWT_SECRET=your_jwt_secret
   JWT_REFRESH_SECRET=your_refresh_secret
   ENCRYPTION_KEY=your_encryption_key
   API_KEY=your_api_key
   ```

### Installation

```bash
pnpm install
pnpm exec prisma generate
```

### Development Server

```bash
pnpm run dev
```

The server will start at `http://localhost:3000`.

### Available Commands

```bash
pnpm run dev              # Start dev server with hot reload
pnpm run dev:debug        # Start with Node debugger
pnpm run build            # Compile TypeScript
pnpm run offline          # Run serverless offline (Lambda emulation)
pnpm exec eslint .        # Run linter
```

## Database

### Neon PostgreSQL Setup

1. Create a project at [console.neon.tech](https://console.neon.tech)
2. Create a database for development
3. Copy the connection string from the dashboard
4. Set `DATABASE_URL` in `.env`

### Prisma Commands

```bash
# Generate Prisma Client (required after schema changes)
pnpm exec prisma generate

# Create a new migration
pnpm exec prisma migrate dev --name migration_name

# Apply migrations
pnpm exec prisma migrate deploy

# Open Prisma Studio (database GUI)
pnpm exec prisma studio

# Reset database (development only)
pnpm exec prisma migrate reset
```

### Schema Management

The Prisma schema is located at `prisma/schema.prisma`. The generated client outputs to `src/generated/prisma` (configured in schema.prisma).

After modifying the schema:
1. Run `pnpm exec prisma migrate dev` to create and apply migration
2. Run `pnpm exec prisma generate` to regenerate the client

## Deployment

### GitHub Actions Setup

The repository uses GitHub Actions to automatically apply database migrations when changes are pushed to the `dev` branch.

#### Configure GitHub Environment

1. Go to repository Settings > Environments
2. Create a new environment named `dev`
3. Configure environment secrets (see below)

#### Required Secrets

Navigate to Settings > Secrets and variables > Actions > Environment secrets (under `dev` environment):

| Secret | Description | Example |
|--------|-------------|---------|
| `DATABASE_URL` | Neon PostgreSQL connection string for dev environment | `postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/dbname?sslmode=require` |

#### Automatic Migration Workflow

The workflow triggers on push to `dev` branch when these files change:
- `ozari-api/prisma/schema.prisma`
- `ozari-api/prisma/migrations/**`
- `ozari-api/prisma.config.ts`
- `.github/workflows/deploy-dev.yml`

Workflow steps:
1. Checkout code
2. Setup pnpm with cache
3. Setup Node.js 22 with dependency caching
4. Install dependencies with `--frozen-lockfile --prefer-offline`
5. Apply migrations with `pnpm exec prisma migrate deploy`

### Serverless Deployment

Deploy to AWS Lambda:

```bash
# Deploy to dev stage
pnpm run deploy

# Deploy to production
pnpm run deploy:prod

# Remove deployment
pnpm remove
```

Configuration is managed in `serverless.yml`.

## Architecture

### Module Structure

Each API module is deployed as a separate Lambda function:

```
src/modules/{module}/
├── {module}.ts           # Lambda handler export
├── {module}.route.ts     # Express router
├── {module}.controller.ts # Request handlers
├── {module}.models.ts    # TypeScript types
└── {module}.validator.ts # Request validation
```

Current modules:
- `auth` - Authentication and user management
- `health` - Health check endpoints
- `products` - Product management

### Shared Infrastructure

- `src/helpers/createApp.ts` - Application factory with middleware configuration
- `src/dependencies/` - Shared dependencies (Prisma, Winston logger)
- `src/middlewares/` - Request middleware (auth, API key validation, roles)
- `src/models/` - Shared TypeScript models

### Environment Detection

- **Local development**: Runs as HTTP server (src/index.ts)
- **AWS Lambda**: Each module runs independently via serverless-http

## Security

### API Key Authentication

All requests require the `x-api-key` header matching the `API_KEY` environment variable.

### Data Encryption

Sensitive data uses encryption patterns:
- Fields with `Kms` suffix are encrypted (e.g., `emailKms`, `fullNameKms`)
- Fields with `Sha` suffix are hashed for indexing (e.g., `emailSha`, `passwordSha`)

### JWT Sessions

JWT tokens are tracked in the `jwt_sessions` table with:
- `jti` - Token identifier
- `deviceUuid` - Device tracking
- `expiresAt` - Expiration timestamp
- `isActive` - Revocation status

## Internationalization

The API uses i18next with:
- Default locale: `es-GT`
- Translations: `src/locales/{locale}/translation.json`
- Detection: `accept-language` header

## Logging

Winston logger configuration:
- Format: JSON (production) / pretty (development)
- Context: Tracked via AsyncLocalStorage per request
- Sensitive data sanitization enabled
