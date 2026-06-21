# Ozari

Cloud-ready business implementation platform.

**Status**: ✅ Deployed and operational on `dev` environment
- **Backend**: Google Cloud Run via Cloud Build
- **Frontend**: Cloudflare Pages
- **Database**: Neon PostgreSQL 17

**Note**: Currently deployed on `dev` branch. Production `main` branch will be created after MVP completion.

## Architecture

This is a monorepo containing:

- **ozari-api** - Backend API (Express.js + Prisma + PostgreSQL)
- **ozari-app** - Frontend application (React + Vite + TanStack Router)

## Tech Stack

| Layer          | Technology                    |
|----------------|-------------------------------|
| Frontend       | React 19 + Vite + Tailwind 4  |
| Backend        | Express.js + Node.js 22       |
| Database       | PostgreSQL 17 (Neon)          |
| ORM            | Prisma                        |
| Deployment     | Cloud Run (Backend) + Cloudflare Pages (Frontend) |
| Security       | SSL/TLS + JWT + API Keys + CSP |

## Prerequisites

- Node.js >= 22
- pnpm >= 10

## Quick Start

### Backend

See [ozari-api/README.md](./ozari-api/README.md) for detailed backend setup, database configuration, and deployment instructions.

```bash
cd ozari-api
pnpm install
pnpm exec prisma generate
pnpm run dev
```

### Frontend

See [ozari-app/README.md](./ozari-app/README.md) for frontend-specific development guidelines.

```bash
cd ozari-app
pnpm install
pnpm run dev
```


## Development Workflow

1. Clone the repository
2. Configure environment variables (see respective README files)
   - Backend: Copy `ozari-api/.env.example` to `ozari-api/.env`
   - Frontend: Copy `ozari-app/.env.example` to `ozari-app/.env`
3. Install dependencies in both `ozari-api` and `ozari-app`
   ```bash
   cd ozari-api && pnpm install
   cd ../ozari-app && pnpm install
   ```
4. Generate Prisma client
   ```bash
   cd ozari-api && pnpm exec prisma generate
   ```
5. Start development servers
   ```bash
   # Terminal 1 - Backend
   cd ozari-api && pnpm run dev

   # Terminal 2 - Frontend
   cd ozari-app && pnpm run dev
   ```
6. Access the application at `http://localhost:5173`

## Deployment

The project is configured for automatic deployments:

- **Backend**: Cloud Build trigger uses `ozari-api/cloudbuild.yaml` to build, migrate, and deploy to Cloud Run
- **Frontend**: Push to `dev` branch triggers Cloudflare Pages deployment
- **Database Migrations**: Cloud Build runs `prisma migrate deploy` once per backend deployment using the Neon direct URL secret

See individual README files for detailed deployment configuration.

## Repository Structure

```
ozari/
├── ozari-api/          # Backend API
│   ├── src/
│   ├── prisma/
│   └── README.md       # Backend documentation
├── ozari-app/          # Frontend application
│   ├── src/
│   └── README.md       # Frontend documentation
├── CLAUDE.md           # Assistant/project operation notes
└── README.md           # This file
```

## Documentation

- [Backend API Documentation](./ozari-api/README.md)
- [Frontend Application Documentation](./ozari-app/README.md)

## License

Proprietary
