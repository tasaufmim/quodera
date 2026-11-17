import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/auth/[...all]/route";

/**
 * The auth CATCH-ALL route through its actual exported handler — this is
 * where the per-IP guard (GUARDRAILS #6) lives, not inside better-auth.
 *
 * Distinguishing detail: better-auth applies its own internal limits to
 * magic-link requests (also 429) — but ONLY ours attach the x-ratelimit-*
 * contract headers. The 11th request must be OURS.
 */
const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL ?? runtimeUrl;

const ORIGIN = "http://localhost:3000";

const d = describe.skipIf(!runtimeUrl)("auth route guard (per-IP limits)", () => {
  let cleanup: postgres.Sql;

  beforeAll(async () => {
    const { applyMigrations } = await import("../db/migrate-lib");
    await applyMigrations(adminUrl!);
    cleanup = postgres(adminUrl!, { prepare: false, max: 1 });
  });

  afterAll(async () => {
    await cleanup?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await cleanup`truncate table "user", "session", "account", "verification" cascade`;
  });

  it("blocks the 11th sensitive auth request from one IP with the shared 429 contract", async () => {
    const email = `dave-${crypto.randomUUID()}@example.test`;

    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const response = await POST(
        new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify({ email, callbackURL: "/dashboard" }),
        }),
      );
      statuses.push(response.status);
    }
    // the first 10 are better-auth's business: 200, or its own 429 once its
    // internal limiter kicks in — either way, they answer with a body
    expect(statuses.every((status) => [200, 429].includes(status))).toBe(true);

    const eleventh = await POST(
      new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email, callbackURL: "/dashboard" }),
      }),
    );

    // OUR guard: x-ratelimit headers are the contract only we attach
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get("x-ratelimit-limit")).toBe("10");
    expect(eleventh.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(Number(eleventh.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await eleventh.json()) as { error: string };
    expect(body.error).toBe("rate_limited");
  });

  it("does not guard non-sensitive auth reads (get-session stays unthrottled)", async () => {
    for (let i = 0; i < 12; i++) {
      const response = await GET(
        new Request(`${ORIGIN}/api/auth/get-session`, {
          method: "GET",
          headers: { origin: ORIGIN },
        }),
      );
      // 12 straight requests exceed the sensitive quota — none may trip it,
      // and every one must answer (200 with a null session), not 429
      expect(response.status).toBe(200);
      expect(response.headers.get("x-ratelimit-limit")).toBeNull();
    }
  });
});

export { d as authRouteGuardSuite };
