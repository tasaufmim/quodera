import { withApi } from "@/server/lib/api-handler";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

/**
 * Liveness probe — must stay dependency-free: no DB, no storage, no auth.
 * Uptime monitoring (BetterStack) pings this; deploy-smoke.yml asserts it.
 */
export const GET = withApi("health", async () => {
  return Response.json({
    status: "ok",
    service: "quodera",
    version: pkg.version,
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    uptimeSeconds: Math.round(process.uptime()),
  });
});
