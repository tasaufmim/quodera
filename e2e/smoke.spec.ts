import { expect, test } from "@playwright/test";

/**
 * Phase 1 smoke: the routes that must never break, regardless of feature
 * phase — the landing page, the probes, and the rate-limit contract.
 * Runs against the production build (playwright.config.ts boots `pnpm start`).
 */
test("landing page renders the pitch", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("demonstrated");
});

test("dashboard placeholder renders", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
});

test("health endpoint reports ok without any dependency", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);

  const body = (await response.json()) as { status: string; service: string };
  expect(body.status).toBe("ok");
  expect(body.service).toBe("quodera");
});

test("ready endpoint responds with a structured report (200 or 503)", async ({ request }) => {
  const response = await request.get("/api/ready");
  expect([200, 503]).toContain(response.status());

  const body = (await response.json()) as {
    status: string;
    checks: Record<string, { status: string }>;
  };
  expect(body.checks.database).toBeDefined();
});

test("demo-limited returns 429 with Retry-After once the quota is spent", async ({ request }) => {
  // limit: 3 per 30s — the e2e run gets a fresh server, so the counter starts clean
  for (let i = 0; i < 3; i++) {
    const response = await request.get("/api/demo-limited");
    expect(response.status()).toBe(200);
  }

  const denied = await request.get("/api/demo-limited");
  expect(denied.status()).toBe(429);
  expect(Number(denied.headers()["retry-after"])).toBeGreaterThan(0);
  expect(denied.headers()["x-ratelimit-remaining"]).toBe("0");
});

test("auth catch-all is mounted and wrapped by withApi", async ({ request }) => {
  const response = await request.get("/api/auth/get-session");

  // mounted (better-auth answers) and wrapped (withApi's request id present)
  expect([200, 401]).toContain(response.status());
  expect(response.headers()["x-request-id"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

  // must answer JSON (better-auth returns null for an anonymous request —
  // we pin only what we own: the route answers, wrapped, with valid JSON)
  await expect(response.json()).resolves.toBeDefined();
});
