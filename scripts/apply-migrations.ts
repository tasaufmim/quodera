import "dotenv/config";
import { applyMigrations } from "../src/server/db/migrate-lib";

async function main(): Promise<void> {
  // Migrations run over the ADMIN connection (superuser / table owner); the
  // app itself connects with the unprivileged quodera_app role (ADR 0008).
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_ADMIN_URL (or DATABASE_URL) is not set. Copy .env.example to .env first — see docs/ops/PROVISIONING.md.",
    );
    process.exit(1);
  }

  const applied = await applyMigrations(url);
  if (applied.length === 0) {
    console.log("No pending migrations.");
  } else {
    for (const name of applied) {
      console.log(`applied: ${name}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
