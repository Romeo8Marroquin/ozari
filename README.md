# Ozari

Cloud-ready business implementation platform.

## Architecture

This is a monorepo containing:

- **ozari-api** - Backend API (Express.js + Prisma + PostgreSQL)
- **ozari-app** - Frontend application (React + Vite + TanStack Router)

## Tech Stack

| Layer          | Technology                    |
|----------------|-------------------------------|
| Frontend       | React + Vite + Tailwind       |
| Backend        | Express.js + Node.js          |
| Database       | PostgreSQL (Neon)             |
| ORM            | Prisma                        |
| Deployment     | Railway (Backend) + Cloudflare (Frontend) |

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
3. Install dependencies in both `ozari-api` and `ozari-app`
4. Start development servers
5. Access the application at `http://localhost:5173`

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
├── .github/
│   └── workflows/      # CI/CD workflows
└── README.md           # This file
```

## Documentation

- [Backend API Documentation](./ozari-api/README.md)
- [Frontend Application Documentation](./ozari-app/README.md)
- [Development Guide](./CLAUDE.md)

## License

Proprietary
