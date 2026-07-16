import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Prisma 7 removed directUrl. CI maps the Neon direct URL into DATABASE_URL
    // for migrate deploy, while Cloud Run uses the pooled URL at runtime.
    url: process.env["DATABASE_URL"] ?? "",
    // Optional, local-only: a throwaway Neon branch (or local Postgres) that enables real
    // `prisma migrate dev`. Without it, author migrations with the read-only
    // `prisma migrate diff --from-config-datasource --to-schema … --script -o …` (see CLAUDE.md).
    ...(process.env["SHADOW_DATABASE_URL"]
      ? { shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"] }
      : {}),
  },
});
