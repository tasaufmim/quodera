import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withUser } from "./rls";
import { tenancyCanary } from "./schema";

/**
 * Tenancy tests for the canary table (ADR 0008) — the pattern every Phase 2
 * domain table must copy and re-test.
 *
 * Roles matter here (that's the lesson that paid for this suite):
 *  - FIXTURES (migrations, truncate) run over the ADMIN connection
 *    (DATABASE_ADMIN_URL — superuser/table owner).
 *  - Every BEHAVIORAL assertion runs over the RUNTIME role (DATABASE_URL =
 *    quodera_app) — the exact privilege level the production app has.
 *  Testing as a superuser would prove nothing: superusers bypass RLS
 *  categorically, FORCE or not.
 *
 * Requires `pnpm db:up` + `.env` locally; CI provides the pgvector container
 * (see .github/workflows/ci.yml).
 */
const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL ?? runtimeUrl;

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const d = describe.skipIf(!runtimeUrl)("tenancy canary (RLS)", () => {
  let cleanup: postgres.Sql;

  beforeAll(async () => {
    const { applyMigrations } = await import("./migrate-lib");
    await applyMigrations(adminUrl!);
    cleanup = postgres(adminUrl!, { prepare: false, max: 1 });
  });

  afterAll(async () => {
    await cleanup?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    // TRUNCATE is an owner-level power the runtime role deliberately lacks —
    // fixtures use the admin connection for cleanup.
    await cleanup`truncate tenancy_canary`;
  });

  async function seedForUser(userId: string): Promise<void> {
    await withUser(userId, async (tx) => {
      await tx.insert(tenancyCanary).values({
        userId,
        content: `content owned by ${userId}`,
        embedding: [1, 2, 3, 4, 5, 6, 7, 8],
      });
    });
  }

  it("inserts and reads its own rows inside withUser", async () => {
    await seedForUser(UUID_A);

    const rows = await withUser(UUID_A, async (tx) => tx.select().from(tenancyCanary));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(UUID_A);
  });

  it("cannot SELECT another tenant's rows", async () => {
    await seedForUser(UUID_A);

    const rowsAsB = await withUser(UUID_B, async (tx) => tx.select().from(tenancyCanary));

    expect(rowsAsB).toHaveLength(0);
  });

  it("cannot INSERT rows attributed to another tenant (WITH CHECK)", async () => {
    await expect(
      withUser(UUID_B, async (tx) => {
        await tx.insert(tenancyCanary).values({
          userId: UUID_A, // forging ownership as tenant B
          content: "forged row",
          embedding: [1, 2, 3, 4, 5, 6, 7, 8],
        });
      }),
    ).rejects.toThrow();
  });

  it("cannot UPDATE or DELETE another tenant's rows (zero affected)", async () => {
    await seedForUser(UUID_A);

    const updated = await withUser(UUID_B, async (tx) =>
      tx
        .update(tenancyCanary)
        .set({ content: "pwned" })
        .where(eq(tenancyCanary.userId, UUID_A))
        .returning({ id: tenancyCanary.id }),
    );
    expect(updated).toHaveLength(0);

    const deleted = await withUser(UUID_B, async (tx) =>
      tx
        .delete(tenancyCanary)
        .where(eq(tenancyCanary.userId, UUID_A))
        .returning({ id: tenancyCanary.id }),
    );
    expect(deleted).toHaveLength(0);

    // the row is untouched
    const rowsAsA = await withUser(UUID_A, async (tx) => tx.select().from(tenancyCanary));
    expect(rowsAsA).toHaveLength(1);
  });

  it("default-deny: no tenant context means zero rows, even as the table owner", async () => {
    // This case proves FORCE ROW LEVEL SECURITY is actually in force: when
    // migrations and runtime share a role (the Neon default), that role IS the
    // table owner — and owners bypass RLS unless forced.
    // It also proves tenant context never leaks out of withUser transactions
    // (seedForUser ran in one; this query runs outside any).
    await seedForUser(UUID_A);

    const { getDb } = await import("./index");
    const rows = await getDb().select().from(tenancyCanary);

    expect(rows).toHaveLength(0);
  });
});

export { d as rlsTestSuite };
