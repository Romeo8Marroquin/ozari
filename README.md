# Ozari

A cloud-ready business implementation platform.

## Tech Stack

| Layer       | Technology                     |
|-------------|--------------------------------|
| Frontend    | React + Vite + Tailwind        |
| Backend     | Express.js + Node.js           |
| Database    | PostgreSQL (Neon)              |
| ORM         | Prisma                         |

## Prerequisites

- Node.js >= 22
- pnpm

## Local Development

1. Clone the repository
2. Copy `.env.example` to `.env` and configure your environment variables
3. Install dependencies:
   ```bash
   cd ozari-api
   pnpm install
   ```
4. Generate Prisma client:
   ```bash
   pnpm exec prisma generate
   ```
5. Run the development server:
   ```bash
   pnpm run dev
   ```

## Database (Neon)

This project uses [Neon](https://neon.tech) as the PostgreSQL provider.

### Setup

1. Create a project at [console.neon.tech](https://console.neon.tech)
2. Copy the connection string from the dashboard
3. Set `DATABASE_URL` in your local `.env`:
   ```
   DATABASE_URL="postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require"
   ```

### Local Migrations

```bash
cd ozari-api
pnpm exec prisma migrate dev
```

### Production Migrations

Migrations are automatically applied when changes are pushed to the `dev` branch affecting:
- `ozari-api/prisma/schema.prisma`
- `ozari-api/prisma/migrations/**`
- `ozari-api/prisma.config.ts`

## GitHub Secrets

Configure in repository settings (Settings > Secrets and variables > Actions):

| Secret | Description |
|--------|-------------|
| `DATABASE_URL` | Neon PostgreSQL connection string |

### Generating Secure Keys

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```
