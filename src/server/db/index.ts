import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

let db: Db | undefined;

/**
 * Lazy singleton. Importing this module must NEVER require a live database —
 * the app has to boot for health checks, e2e smoke, and hermetic builds even
 * when DATABASE_URL is unset (the lazy init is what makes `next build`
 * env-free).
 */
export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set — copy .env.example to .env (see docs/ops/PROVISIONING.md)",
      );
    }
    const client = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      // Neon's pooled endpoint runs in transaction mode, where prepared
      // statements are disallowed. prepare:false keeps ONE code path for
      // local Docker Postgres and Neon alike.
      prepare: false,
    });
    db = drizzle({ client, schema });
  }
  return db;
}
