import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createAuth } from "@/server/auth";
import { handleChat, type ChatDeps } from "@/server/chat/orchestrate";
import { withUser } from "@/server/db/rls";
import {
  apiUsage,
  chunks,
  citations,
  documents,
  documentVersions,
  messages,
  threads,
} from "@/server/db/schema";
import type { EmbeddingsAccess } from "@/server/embeddings/provider";
import { EMBEDDING_DIMENSIONS } from "@/server/embeddings";
import type { LlmStreamEvent } from "@/server/llm/openrouter";

/**
 * The cited-chat pipeline end-to-end over live Postgres: session → thread →
 * retrieval (synthetic vectors) → scripted LLM → verifier → persistence →
 * SSE events. No network anywhere: the REAL OpenRouter wire contract is the
 * mocked-SSE unit suite.
 */

const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL ?? runtimeUrl;

const ORIGIN = "http://localhost:3000";
let userId: string;

function topicVector(dimension: number): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0.05);
  vector[dimension] = 1;
  return vector;
}

const fakeEmbeddings: EmbeddingsAccess = {
  available: true,
  provider: () => ({ embed: async () => [topicVector(100)] }),
};

/** A scripted LLM: yields the given tokens, then a usage event. */
function scriptedLlm(tokens: string[], usage = { tokensIn: 20, tokensOut: 6 }) {
  return async function* (): AsyncGenerator<LlmStreamEvent> {
    for (const text of tokens) {
      yield { type: "token", text };
    }
    yield { type: "usage", tokensIn: usage.tokensIn, tokensOut: usage.tokensOut };
  };
}

async function parseSse(response: Response): Promise<{
  tokens: string;
  citations: Array<Record<string, unknown>>;
  done: Record<string, unknown> | null;
  error: string | null;
}> {
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const raw = await response.text();
  const tokens: string[] = [];
  let citations: Array<Record<string, unknown>> = [];
  let done: Record<string, unknown> | null = null;
  let error: string | null = null;

  for (const block of raw.split("\n\n")) {
    const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!eventLine || !dataLine) continue;
    const name = eventLine.slice(6).trim();
    const data = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
    if (name === "token") tokens.push(String(data.text));
    if (name === "citations") citations = data.citations as Array<Record<string, unknown>>;
    if (name === "done") done = data;
    if (name === "error") error = String(data.error);
  }
  return { tokens: tokens.join(""), citations, done, error };
}

const d = describe.skipIf(!runtimeUrl)("chat orchestration (cited pipeline)", () => {
  let cleanup: postgres.Sql;
  let cookie: string;
  let originalKey: string | undefined;

  beforeAll(async () => {
    const { applyMigrations } = await import("../db/migrate-lib");
    await applyMigrations(adminUrl!);
    cleanup = postgres(adminUrl!, { prepare: false, max: 1 });
    originalKey = process.env.OPENROUTER_API_KEY;
    // the LLM is scripted — the key only needs to pass the availability gate
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  afterAll(async () => {
    process.env.OPENROUTER_API_KEY = originalKey;
    await cleanup?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    // fresh user per test — the process-global memory limiter keys quota by
    // user, so quota never bleeds between tests (same trick as distinct
    // guest IPs in the auth suite)
    userId = crypto.randomUUID();
    await cleanup`truncate table "user" cascade`;
    await cleanup`
      insert into "user" (id, name, email, is_anonymous, created_at, updated_at)
      values (${userId}, 'chatter', 'chatter@example.test', false, now(), now())
    `;

    // session through the REAL auth stack: capture the magic link, follow it
    const capturedLinks: string[] = [];
    const auth = createAuth({
      sendMagicLink: async ({ url }) => {
        capturedLinks.push(url);
      },
    });
    await auth.handler(
      new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email: "chatter@example.test", callbackURL: "/" }),
      }),
    );
    const verified = await auth.handler(
      new Request(capturedLinks[0]!, { headers: { origin: ORIGIN } }),
    );
    cookie = verified.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0]!)
      .join("; ");
  });

  async function seedLibrary(): Promise<void> {
    await withUser(userId, async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({ userId: userId, name: "lease.pdf", kind: "digital_pdf", status: "ready" })
        .returning({ id: documents.id });
      const [version] = await tx
        .insert(documentVersions)
        .values({ userId: userId, documentId: doc!.id, versionNo: 1 })
        .returning({ id: documentVersions.id });
      await tx.insert(chunks).values({
        userId: userId,
        versionId: version!.id,
        paragraphNo: 1,
        page: 3,
        lineStart: 2,
        lineEnd: 4,
        content: "The tenant shall pay rent in advance on the first day of each month.",
        embedding: topicVector(100),
      });
    });
  }

  function chatRequest(body: unknown, options: { byoKey?: string } = {}): Request {
    const headers: Record<string, string> = { "content-type": "application/json", cookie };
    if (options.byoKey) headers["x-openrouter-key"] = options.byoKey;
    return new Request(`${ORIGIN}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("streams a cited answer: markers verified, citations persisted with provenance", async () => {
    await seedLibrary();
    const response = await handleChat(chatRequest({ content: "When is rent due?" }), {
      embeddings: fakeEmbeddings,
      stream: () => scriptedLlm(["The tenant must pay ", "rent on day one [1]."])(),
    });
    const parsed = await parseSse(response);

    expect(parsed.error).toBeNull();
    expect(parsed.tokens).toBe("The tenant must pay rent on day one [1].");
    expect(parsed.citations).toHaveLength(1);
    expect(parsed.citations[0]).toMatchObject({
      marker: 1,
      documentName: "lease.pdf",
      page: 3,
      paragraphNo: 1,
      lineStart: 2,
      lineEnd: 4,
      quoteVerified: true,
    });
    expect(parsed.done).toMatchObject({ refused: false, uncited: false });

    // persistence: thread + 2 messages + citation row + usage row
    const threadRows = await withUser(userId, (tx) =>
      tx.select({ id: threads.id, title: threads.title }).from(threads),
    );
    expect(threadRows).toHaveLength(1);
    expect(threadRows[0]!.title).toContain("When is rent due?");

    const messageRows = await withUser(userId, (tx) =>
      tx.select({ role: messages.role }).from(messages),
    );
    expect(messageRows.map((m) => m.role).sort()).toEqual(["assistant", "user"]);

    const citationRows = await withUser(userId, (tx) =>
      tx
        .select({ marker: citations.marker, verified: citations.verified, span: citations.span })
        .from(citations),
    );
    expect(citationRows).toHaveLength(1);
    expect(citationRows[0]!.marker).toBe(1);
    expect(citationRows[0]!.verified).toBe(true);
    expect(citationRows[0]!.span).toContain("rent in advance");

    const usageRows = await withUser(userId, (tx) =>
      tx.select({ route: apiUsage.route, provider: apiUsage.provider }).from(apiUsage),
    );
    expect(usageRows).toEqual([{ route: "chat", provider: "openrouter" }]);
  });

  it("flags an uncited answer instead of faking references", async () => {
    await seedLibrary();
    const parsed = await parseSse(
      await handleChat(chatRequest({ content: "When is rent due?" }), {
        embeddings: fakeEmbeddings,
        stream: () => scriptedLlm(["Rent is due on day one."])(),
      }),
    );
    expect(parsed.citations).toEqual([]);
    expect(parsed.done).toMatchObject({ uncited: true });
  });

  it("refuses on an empty library — FREE: no quota spent, no usage row, honest text", async () => {
    const parsed = await parseSse(
      await handleChat(chatRequest({ content: "When is rent due?" }), {
        embeddings: fakeEmbeddings,
        stream: () => scriptedLlm(["never"])(),
      }),
    );

    expect(parsed.tokens).toContain("don't cover this question");
    expect(parsed.done).toMatchObject({ refused: true });
    expect(parsed.citations).toEqual([]);

    const usageRows = await withUser(userId, (tx) => tx.select({ id: apiUsage.id }).from(apiUsage));
    expect(usageRows).toHaveLength(0);
  });

  it("enforces the demo pool at 5/day with the shared 429 contract", async () => {
    await seedLibrary();
    const deps: ChatDeps = {
      embeddings: fakeEmbeddings,
      stream: () => scriptedLlm(["ok [1]"])(),
    };

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const response = await handleChat(chatRequest({ content: `rent question ${i}` }), deps);
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200]);

    const sixth = await handleChat(chatRequest({ content: "one more" }), deps);
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("x-ratelimit-limit")).toBe("5");
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("BYO keys bypass the demo pool (their own infra limit applies)", async () => {
    await seedLibrary();
    const parsed = await parseSse(
      await handleChat(chatRequest({ content: "When is rent due?" }, { byoKey: "sk-user" }), {
        embeddings: fakeEmbeddings,
        stream: () => scriptedLlm(["Day one [1]."])(),
      }),
    );
    expect(parsed.done).toMatchObject({ refused: false, uncited: false });
  });

  it("404s a thread that does not exist (or is not the caller's)", async () => {
    const response = await handleChat(
      chatRequest({ threadId: crypto.randomUUID(), content: "hi" }),
      { embeddings: fakeEmbeddings },
    );
    expect(response.status).toBe(404);
  });

  it("continues a thread: history as context, citations persist per turn", async () => {
    await seedLibrary();
    const deps: ChatDeps = {
      embeddings: fakeEmbeddings,
      stream: () => scriptedLlm(["First answer [1]."])(),
    };

    const first = await parseSse(
      await handleChat(chatRequest({ content: "When is rent due?" }), deps),
    );
    const threadId = String(first.done!.threadId);

    const second = await parseSse(
      await handleChat(chatRequest({ threadId, content: "And what does it say exactly?" }), {
        ...deps,
        stream: () => scriptedLlm(["It says day one [1]."])(),
      }),
    );
    expect(second.done).toMatchObject({ refused: false });

    const threadMessages = await withUser(userId, (tx) =>
      tx.select({ role: messages.role }).from(messages).where(eq(messages.threadId, threadId)),
    );
    expect(threadMessages).toHaveLength(4); // 2 questions, 2 answers

    const threadCitations = await withUser(userId, (tx) =>
      tx
        .select({ marker: citations.marker })
        .from(citations)
        .innerJoin(messages, eq(citations.messageId, messages.id))
        .where(eq(messages.threadId, threadId)),
    );
    expect(threadCitations).toHaveLength(2); // one citation per assistant turn
  });

  it("503s honestly when neither BYO nor a demo key exists and the library HAS content", async () => {
    await seedLibrary();
    const key = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const response = await handleChat(chatRequest({ content: "When is rent due?" }), {
        embeddings: fakeEmbeddings,
      });
      expect(response.status).toBe(503);
      expect(((await response.json()) as { error: string }).error).toBe("chat-unavailable");
    } finally {
      process.env.OPENROUTER_API_KEY = key;
    }
  });

  it("rejects anonymous callers", async () => {
    const response = await handleChat(
      new Request(`${ORIGIN}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hi" }),
      }),
    );
    expect(response.status).toBe(401);
  });
});

export { d as chatOrchestrationSuite };
