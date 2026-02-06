import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.test.ts",
        "**/*.config.ts",
        "**/tests/**",
        "src/index.ts",
        "src/app.ts",
        "prisma/**",
        "**/*Enum.ts",
        "**/*Model.ts",
        "**/*Model*.ts",
        "**/*.models.ts",
        "**/models/**",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
    include: ["src/**/*.test.ts"],
    exclude: ["tests/**", "node_modules/**", "dist/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@models": path.resolve(__dirname, "./src/models"),
      "@services": path.resolve(__dirname, "./src/services"),
      "@helpers": path.resolve(__dirname, "./src/helpers"),
      "@middlewares": path.resolve(__dirname, "./src/middlewares"),
      "@modules": path.resolve(__dirname, "./src/modules"),
      "@config": path.resolve(__dirname, "./src/config"),
      "@types": path.resolve(__dirname, "./src/types"),
    },
  },
});
