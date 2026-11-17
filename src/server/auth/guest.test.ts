import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as purgeRoute } from "@/app/api/cron/purge-guests/route";
import { createAuth } from "./index";
import { purgeExpiredGuests, GUEST_EMAIL_DOMAIN } from "./purge";

/**
 * Guest mode (ADR 0009), driven end-to-end through real handlers:
 * creation → caps → 24h TTL → upgrade linking → purge → cron route auth.
 *
 * Each test uses a distinct x-forwarded-for so the per-IP creation cap
 * (3/day, memory driver in tests) never bleeds between cases.
 */
const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL ?? runtimeUrl;

const ORIGIN = "http://localhost:3000";

const d = describe.skipIf(!runtimeUrl)("guest mode (ADR 0009)", () => {
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

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  function guestRequest(ip: string, cookie?: string): Request {
    return new Request(`${ORIGIN}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { origin: ORIGIN, "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) },
    });
  }

  it("creates a guest session: ghost row, placeholder email, hard 24h TTL", async () => {
    const auth = createAuth();

    const response = await auth.handler(guestRequest("10.1.0.1"));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      user: { id: string; isAnonymous: boolean; email: string };
    };
    expect(body.user.isAnonymous).toBe(true);
    expect(body.user.email).toContain(GUEST_EMAIL_DOMAIN);

    // the session row carries the 24h clamp, not the 7d default
    const [session] = await cleanup`
      select extract(epoch from (expires_at - created_at)) as ttl
      from "session" where user_id = ${body.user.id}
    `;
    const ttlSeconds = Number(session!.ttl);
    expect(ttlSeconds).toBeGreaterThan(24 * 60 * 60 - 60);
    expect(ttlSeconds).toBeLessThanOrEqual(24 * 60 * 60 + 60);
  });

  it("caps guest creation at 3/day per IP with the shared 429 contract", async () => {
    // The cap lives in the ROUTE guard — every request must go through it
    // for the counter to see them all.
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const ip = "10.1.0.2";

    for (let i = 0; i < 3; i++) {
      const response = await POST(guestRequest(ip));
      expect(response.status).toBe(200);
    }

    const fourth = await POST(guestRequest(ip));

    expect(fourth.status).toBe(429);
    expect(fourth.headers.get("x-ratelimit-limit")).toBe("3");
    expect(Number(fourth.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await fourth.json()) as { error: string };
    expect(body.error).toBe("rate_limited");
  });

  it("registers a guest with a real identity — ghost retired, both ids captured for carry-over", async () => {
    const capturedLinks: string[] = [];
    const linkedPairs: Array<{ from: string; to: string }> = [];
    const auth = createAuth({
      sendMagicLink: async ({ url }) => {
        capturedLinks.push(url);
      },
      onLinkAccount: async ({ anonymousUserId, newUserId }) => {
        linkedPairs.push({ from: anonymousUserId, to: newUserId });
      },
    });
    const email = `eve-${crypto.randomUUID()}@example.test`;

    // 1. become a guest
    const guestResponse = await auth.handler(guestRequest("10.1.0.3"));
    const guestBody = (await guestResponse.json()) as { user: { id: string } };
    const ghostId = guestBody.user.id;
    const guestCookie = guestResponse.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0]!)
      .join("; ");

    // 2. register via magic link FROM the guest session
    const send = await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-forwarded-for": "10.1.0.3",
          cookie: guestCookie,
        },
        body: JSON.stringify({ email, callbackURL: "/dashboard" }),
      }),
    );
    expect(send.status).toBe(200);
    expect(capturedLinks).toHaveLength(1);

    const verified = await auth.handler(
      new Request(capturedLinks[0]!, { headers: { origin: ORIGIN, cookie: guestCookie } }),
    );
    expect([200, 302]).toContain(verified.status);

    // 3. better-auth's semantics (ADR 0009 postscript): the registered user is
    //    NEW and the ghost is deleted — and onLinkAccount received BOTH ids,
    //    which is where Phase 2.4 copies tenant data before the ghost dies.
    const [ghostRow] = await cleanup`select id from "user" where id = ${ghostId}`;
    expect(ghostRow).toBeUndefined();

    const [registered] = await cleanup`
      select id, email, is_anonymous from "user" where email = ${email}
    `;
    expect(registered!.email).toBe(email);
    expect(registered!.is_anonymous).toBe(false);
    expect(registered!.id).not.toBe(ghostId);

    expect(linkedPairs).toHaveLength(1);
    expect(linkedPairs[0]!.from).toBe(ghostId);
    expect(linkedPairs[0]!.to).toBe(registered!.id);
  });

  it("purges stale guests and cascades their sessions — fresh/registered stay", async () => {
    const staleId = crypto.randomUUID();
    const freshId = crypto.randomUUID();
    const registeredId = crypto.randomUUID();

    // NOTE: the interval is a literal, not a parameter — postgres.js writes
    // template params as $n placeholders, and quoting inside interval ''
    // would make the placeholder a literal string. 49h = purge window + 1.
    await cleanup`
      insert into "user" (id, name, email, is_anonymous, created_at, updated_at)
      values (${staleId}, 'stale', ${`stale@${GUEST_EMAIL_DOMAIN}`}, true, now() - interval '49 hours', now() - interval '49 hours')
    `;
    await cleanup`
      insert into "user" (id, name, email, is_anonymous, created_at, updated_at)
      values (${freshId}, 'fresh', ${`fresh@${GUEST_EMAIL_DOMAIN}`}, true, now(), now())
    `;
    await cleanup`
      insert into "user" (id, name, email, is_anonymous, created_at, updated_at)
      values (${registeredId}, 'real', 'real@example.test', false, now(), now())
    `;
    await cleanup`
      insert into "session" (id, user_id, token, expires_at)
      values (${crypto.randomUUID()}, ${staleId}, ${`tok-${crypto.randomUUID()}`}, now() + interval '1 hour')
    `;

    const purged = await purgeExpiredGuests(adminUrl!);
    expect(purged).toBe(1);

    const [staleUser] = await cleanup`select id from "user" where id = ${staleId}`;
    expect(staleUser).toBeUndefined();

    const [staleSession] = await cleanup`select id from "session" where user_id = ${staleId}`;
    expect(staleSession).toBeUndefined();

    const [freshUser] = await cleanup`select id from "user" where id = ${freshId}`;
    expect(freshUser).toBeTruthy();
    const [registeredUser] = await cleanup`select id from "user" where id = ${registeredId}`;
    expect(registeredUser).toBeTruthy();
  });

  it("purge cron route fails closed without a secret, accepts the real one", async () => {
    const request = (secret?: string) =>
      new Request(`${ORIGIN}/api/cron/purge-guests`, {
        method: "GET",
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
      });

    // no secret configured → closed
    expect((await purgeRoute(request())).status).toBe(401);
    // wrong secret → closed
    process.env.CRON_SECRET = "the-real-cron-secret";
    expect((await purgeRoute(request("wrong"))).status).toBe(401);
    // right secret → runs (nothing to purge, but the route works end-to-end)
    const ok = await purgeRoute(request("the-real-cron-secret"));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { purgedGuests: number };
    expect(body.purgedGuests).toBeGreaterThanOrEqual(0);
  });
});

export { d as guestModeSuite };
