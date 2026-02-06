# Ozari API

Modern Express TypeScript API for the Ozari platform.

**Status**: ✅ Deployed on Railway (dev environment)

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
pnpm run prisma:migrate

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
│   └── products/      # Products CRUD
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
- `GET /api/auth/refresh` - Refresh token (public)
- `GET /api/auth/signout` - Sign out (protected)
- `GET /api/auth/all` - Get all users (admin only)

### Products

- `GET /api/products/all` - Get all products (protected)
- `POST /api/products/create` - Create product (admin only)
- `PUT /api/products/update` - Update product (admin only)
- `DELETE /api/products/delete` - Delete product (admin only)

## Authentication

All requests require `x-api-key` header:

```bash
# Local development
curl -H "x-api-key: your-api-key" http://localhost:3000/api/health/check

# Production
curl -H "x-api-key: your-api-key" <your-railway-url>/api/health/check
```

Protected endpoints also require JWT access token:

```bash
curl -H "x-api-key: your-api-key" \
     -H "Authorization: Bearer <access-token>" \
     http://localhost:3000/api/products/all
```

**Note**: The frontend automatically includes the API key from the `VITE_API_KEY` environment variable in all requests.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NODE_ENV` | Environment (development/production) | No |
| `HOST` | Server host | No (default: localhost) |
| `PORT` | Server port | No (default: 3000) |
| `APP_HOST` | Frontend URL for CORS | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `JWT_REFRESH_SECRET` | Refresh token secret | Yes |
| `ENCRYPTION_KEY` | AES-256 encryption key (hex) | Yes |
| `API_KEY` | API authentication key | Yes |
| `LOG_LEVEL` | Winston log level | No (default: info) |

## Deployment

### Railway

**Status**: ✅ Deployed and operational

The backend is deployed on Railway with automatic deployments from the `dev` branch.

**Configuration**:
- **Platform**: Railway
- **Build Command**: `pnpm run build`
- **Start Command**: `pnpm start`
- **Auto-Deploy**: Enabled from `dev` branch
- **Database**: Neon PostgreSQL 17 (direct connection via `@prisma/adapter-pg`)
- **Node Version**: 22

**Environment Variables** (configured in Railway dashboard):
```bash
NODE_ENV=production
API_HOST=0.0.0.0
PORT=${{PORT}}              # Railway provides this automatically
API_BASE_PATH=/api
APP_HOST=<cloudflare-frontend-url>
DATABASE_URL=<neon-postgresql-connection-string>
JWT_SECRET=<generated-secret>
JWT_REFRESH_SECRET=<generated-secret>
ENCRYPTION_KEY=<generated-secret>
API_KEY=<generated-secret>
LOG_LEVEL=info
```

**Generate Secrets** (for local development):
```bash
# JWT secrets (use different values for each)
openssl rand -hex 32

# Encryption key (32 bytes)
openssl rand -hex 32

# API key
openssl rand -hex 32
```

**Setup Steps**:
1. Create new project in Railway
2. Connect GitHub repository
3. Configure environment variables above
4. Enable auto-deploy from `dev` branch
5. Railway will automatically build and deploy on push

**Database Migrations**:
- Migrations are applied via GitHub Actions on push to `dev` branch
- See `.github/workflows/deploy-dev.yml` for configuration
- Workflow triggers on changes to:
  - `ozari-api/prisma/schema.prisma`
  - `ozari-api/prisma/migrations/**`
  - `ozari-api/prisma.config.ts`

**Health Check**:
```bash
curl <your-railway-url>/api/health/check
```

### Docker (Optional)

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build
CMD ["pnpm", "start"]
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
| `pnpm run prisma:deploy` | Deploy migrations (production) |
| `pnpm run prisma:studio` | Open Prisma Studio |
| `pnpm run lint` | Run ESLint |
| `pnpm run lint:fix` | Fix ESLint errors |
| `pnpm run type-check` | Check TypeScript types |

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
