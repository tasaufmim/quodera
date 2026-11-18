import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/server/db/schema.ts", "./src/server/storage/dev-schema.ts"],
  // Generated SQL lands here. Hand-written RLS/index "hardening" SQL lives in
  // migrations/hardening/ — see scripts/apply-migrations.ts for how both are applied.
  out: "./src/server/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
