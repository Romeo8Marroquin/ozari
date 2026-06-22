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
  },
});
