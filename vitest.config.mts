import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Loads .env (if present) so db tests can find DATABASE_URL; CI sets env
    // vars directly instead.
    setupFiles: ["dotenv/config"],
    // The db/auth/guest suites share ONE physical Postgres and truncate
    // fixtures per test — parallel FILES would race each other's truncates
    // (bitten for real in Phase 2.3). Sequential files is correctness.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
