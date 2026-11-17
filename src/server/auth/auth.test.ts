import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "./index";

/**
 * Auth core tests (Phase 2.1): the full magic-link round trip, driven through
 * auth.handler with real HTTP semantics — no mocked internals.
 *
 * Requires a live Postgres (`pnpm db:up` + `.env` locally; the pgvector
 * container in CI). Fixtures run on the admin connection; the auth instance
 * itself connects as the runtime role, exactly like production.
 *
 * The anonymous/guest plugin is deliberately NOT enabled here — it ships in
 * Phase 2.3 behind the IP-capped creation route (ADR 0009).
 */
const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL ?? runtimeUrl;

const ORIGIN = "http://localhost:3000";

const d = describe.skipIf(!runtimeUrl)("auth core (magic link)", () => {
  let cleanup: postgres.Sql;
  const capturedLinks: string[] = [];

  beforeAll(async () => {
    const { applyMigrations } = await import("../db/migrate-lib");
    await applyMigrations(adminUrl!);
    cleanup = postgres(adminUrl!, { prepare: false, max: 1 });
  });

  afterAll(async () => {
    await cleanup?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    capturedLinks.length = 0;
    await cleanup`truncate table "user", "session", "account", "verification" cascade`;
  });

  function request(
    path: string,
    method: "GET" | "POST",
    options: { body?: unknown; cookie?: string } = {},
  ): Request {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.cookie) headers.cookie = options.cookie;
    return new Request(`${ORIGIN}/api/auth${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  }

  it("sends a magic link, then verifies it into a working session", async () => {
    const auth = createAuth({
      sendMagicLink: async ({ url }) => {
        capturedLinks.push(url);
      },
    });
    const email = `alice-${crypto.randomUUID()}@example.test`;

    // 1. request a magic link
    const send = await auth.handler(
      request("/sign-in/magic-link", "POST", { body: { email, callbackURL: "/dashboard" } }),
    );
    expect(send.status).toBe(200);
    expect(capturedLinks).toHaveLength(1);

    // 2. follow the emailed link — the one-time token is consumed here
    const verified = await auth.handler(
      new Request(capturedLinks[0]!, { headers: { origin: ORIGIN } }),
    );
    expect([200, 302]).toContain(verified.status);

    const setCookies = verified.headers.getSetCookie();
    const sessionCookie = setCookies.find((cookie) => cookie.includes("session"));
    expect(sessionCookie).toBeTruthy();

    // 3. the minted cookie resolves to the user
    const sessionResponse = await auth.handler(
      request("/get-session", "GET", { cookie: sessionCookie!.split(";")[0] }),
    );
    expect(sessionResponse.status).toBe(200);
    const { user } = (await sessionResponse.json()) as { user: { email: string } };
    expect(user.email).toBe(email);
  });

  it("cannot reuse an already-consumed magic link token", async () => {
    const auth = createAuth({
      sendMagicLink: async ({ url }) => {
        capturedLinks.push(url);
      },
    });
    const email = `bob-${crypto.randomUUID()}@example.test`;

    await auth.handler(
      request("/sign-in/magic-link", "POST", { body: { email, callbackURL: "/dashboard" } }),
    );
    const link = capturedLinks[0]!;

    const first = await auth.handler(new Request(link, { headers: { origin: ORIGIN } }));
    expect([200, 302]).toContain(first.status);

    // the token was consumed atomically — a replay must not mint a session
    const replay = await auth.handler(new Request(link, { headers: { origin: ORIGIN } }));
    expect(replay.headers.getSetCookie().some((c) => c.includes("session"))).toBe(false);
  });

  it("leaves rows only in the system tables (no stray tenant data)", async () => {
    const auth = createAuth({
      sendMagicLink: async ({ url }) => {
        capturedLinks.push(url);
      },
    });
    const email = `carol-${crypto.randomUUID()}@example.test`;

    await auth.handler(
      request("/sign-in/magic-link", "POST", { body: { email, callbackURL: "/dashboard" } }),
    );
    await auth.handler(new Request(capturedLinks[0]!, { headers: { origin: ORIGIN } }));

    const users = await cleanup`select id, email, is_anonymous from "user"`;
    expect(users).toHaveLength(1);
    expect(users[0]!.email).toBe(email);
    expect(users[0]!.is_anonymous).toBe(false);

    const sessions = await cleanup`select user_id from "session"`;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.user_id).toBe(users[0]!.id);
  });

  it("answers unknown auth paths with 404 (not 500)", async () => {
    const auth = createAuth();
    const response = await auth.handler(request("/does-not-exist", "GET"));
    expect(response.status).toBe(404);
  });
});

export { d as authTestSuite };
