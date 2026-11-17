import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { withApi } from "@/server/lib/api-handler";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "fail" | "unconfigured";

interface ReadyCheck {
  status: CheckStatus;
  detail?: string;
}

/**
 * Readiness probe — unlike /api/health, this touches real dependencies.
 * A 503 here means "deploy is up but degraded", which is exactly what
 * deploy-smoke.yml and dashboards want to distinguish.
 */
export const GET = withApi("ready", async () => {
  const checks: Record<string, ReadyCheck> = {};

  if (!process.env.DATABASE_URL) {
    checks.database = { status: "unconfigured", detail: "DATABASE_URL is not set" };
  } else {
    try {
      const started = Date.now();
      await getDb().execute(sql`select 1`);
      checks.database = { status: "ok", detail: `${Date.now() - started}ms` };
    } catch (error) {
      checks.database = {
        status: "fail",
        detail: error instanceof Error ? error.message : "unknown error",
      };
    }
  }

  const ready = Object.values(checks).every((check) => check.status === "ok");

  return Response.json(
    { status: ready ? "ready" : "not_ready", checks },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
});
