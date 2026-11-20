import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getSessionUser, type SessionUser } from "@/server/auth/session";
import { withUser } from "@/server/db/rls";
import { apiUsage, citations, documents, messages, threads } from "@/server/db/schema";
import type { EmbeddingsAccess } from "@/server/embeddings/provider";
import { getEmbeddings } from "@/server/embeddings/provider";
import { logger } from "@/server/lib/logger";
import { streamOpenRouter, type ChatMessage, type LlmStreamEvent } from "@/server/llm/openrouter";
import { tooManyRequests } from "@/server/rate-limit/headers";
import { getLimiter } from "@/server/rate-limit/limiter";
import { POLICY } from "@/server/rate-limit/policy";
import { hybridSearch, type RetrievedChunk } from "@/server/retrieval/search";
import { buildChatPrompt } from "./prompt";
import { encodeEvent, sseHeaders, type CitationEvent } from "./protocol";
import { verifyReferences } from "./verifier";

/**
 * The chat orchestrator (Phase 4.2/4.3 — ADR 0007/0011):
 * session → thread → message → retrieval → (refusal is FREE) → quota →
 * LLM stream → verify markers → persist citations + usage → SSE.
 *
 * Order matters: a refusal (empty retrieval) short-circuits BEFORE the
 * quota — an empty library cannot burn a user's 5/day pool on "the
 * documents don't cover this". BYO keys bypass the demo pool and are
 * infra-rate-limited instead; either way every generated message is metered.
 */

const BYO_KEY_HEADER = "x-openrouter-key";

/** The free-models router: self-heals as OpenRouter's free roster turns over. */
const DEFAULT_DEMO_MODEL = "openrouter/free";
const DEFAULT_BYO_MODEL = "deepseek/deepseek-chat-v3.1";

const bodySchema = z.object({
  threadId: z.string().uuid().optional(),
  content: z.string().trim().min(1).max(4000),
  model: z.string().trim().max(120).optional(),
});

const REFUSAL_TEXT =
  "The uploaded documents don't cover this question. Add the relevant document or ask about something in your library.";

export interface ChatDeps {
  /** Injectable for tests; defaults to the real search with real embeddings. */
  search?: typeof hybridSearch;
  embeddings?: EmbeddingsAccess;
  /** Injectable LLM stream (tests avoid any network). */
  stream?: (options: {
    apiKey: string;
    model: string;
    messages: ChatMessage[];
  }) => AsyncGenerator<LlmStreamEvent>;
}

export async function handleChat(request: Request, deps: ChatDeps = {}): Promise<Response> {
  const session = await getSessionUser(request);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid-request" }, { status: 400 });
  }
  const { threadId: givenThreadId, content, model: requestedModel } = parsed.data;

  // resolve/create the thread (RLS makes an unowned threadId invisible → 404)
  const thread = await resolveThread(session.id, givenThreadId, content);
  if (!thread) {
    return Response.json({ error: "thread-not-found" }, { status: 404 });
  }

  // store the user message before anything else — the question is never lost
  await withUser(session.id, (tx) =>
    tx
      .insert(messages)
      .values({ userId: session.id, threadId: thread.threadId, role: "user", content }),
  );

  // retrieval — v1 follow-up heuristic: concatenate prior user messages so
  // "what about page 3?" carries its antecedent (deterministic, no LLM call;
  // LLM rewriting joins rerank in the eval-gated later pass — ADR 0011)
  const searchFn = deps.search ?? hybridSearch;
  const embeddings = deps.embeddings ?? getEmbeddings();
  const historyText = thread.history
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .slice(-2)
    .join(" ");
  const retrievalQuery = `${historyText} ${content}`.trim().slice(0, 500);

  const search = await searchFn(session.id, retrievalQuery, {}, embeddings);

  if (search.refused) {
    // free refusal: no quota, no LLM, no usage row
    await storeAssistantMessage(session.id, thread.threadId, REFUSAL_TEXT, []);
    return simpleStream([
      ["token", { text: REFUSAL_TEXT }],
      ["citations", { citations: [] }],
      ["done", { threadId: thread.threadId, refused: true, uncited: false }],
    ]);
  }

  // quota AFTER the refusal gate (an empty library can't drain the pool)
  const byoKey = request.headers.get(BYO_KEY_HEADER)?.trim() || undefined;
  const demoKey = process.env.OPENROUTER_API_KEY; // per-request, like CRON_SECRET

  if (byoKey) {
    const infra = await getLimiter().limit(`chat-infra:${session.id}`, POLICY.byoChatPerHour);
    if (!infra.success) {
      return tooManyRequests(infra);
    }
  } else {
    if (!demoKey) {
      return Response.json({ error: "chat-unavailable" }, { status: 503 });
    }
    const quota = await getLimiter().limit(`chat:${session.id}`, POLICY.demoChatDaily);
    if (!quota.success) {
      return tooManyRequests(quota);
    }
  }

  const apiKey = byoKey ?? demoKey!;
  const model =
    requestedModel ??
    (byoKey
      ? (process.env.OPENROUTER_BYO_MODEL ?? DEFAULT_BYO_MODEL)
      : (process.env.OPENROUTER_DEMO_MODEL ?? DEFAULT_DEMO_MODEL));

  const documentNames = await loadDocumentNames(session.id, search.chunks);
  const prompt = buildChatPrompt({
    question: content,
    evidence: search.chunks,
    documentNames,
    history: thread.history,
  });

  const streamFn =
    deps.stream ??
    ((options: { apiKey: string; model: string; messages: ChatMessage[] }) =>
      streamOpenRouter(options));

  return generationStream({
    session,
    threadId: thread.threadId,
    prompt,
    apiKey,
    model,
    search,
    documentNames,
    streamFn,
  });
}

interface ThreadContext {
  threadId: string;
  history: ChatMessage[];
}

async function resolveThread(
  userId: string,
  givenThreadId: string | undefined,
  firstMessage: string,
): Promise<ThreadContext | null> {
  if (givenThreadId) {
    const rows = await withUser(userId, (tx) =>
      tx
        .select({ id: threads.id })
        .from(threads)
        .where(and(eq(threads.userId, userId), eq(threads.id, givenThreadId)))
        .limit(1),
    );
    if (rows.length === 0) return null;

    const rows10 = await withUser(userId, (tx) =>
      tx
        .select({ role: messages.role, content: messages.content })
        .from(messages)
        .where(eq(messages.threadId, givenThreadId))
        .orderBy(desc(messages.createdAt))
        .limit(10),
    );
    return {
      threadId: givenThreadId,
      history: rows10
        .reverse()
        .map((message) => ({ role: message.role, content: message.content }) as ChatMessage),
    };
  }

  const [thread] = await withUser(userId, (tx) =>
    tx
      .insert(threads)
      .values({ userId, title: firstMessage.slice(0, 60) })
      .returning({ id: threads.id }),
  );
  return { threadId: thread!.id, history: [] };
}

async function loadDocumentNames(
  userId: string,
  retrieved: RetrievedChunk[],
): Promise<Map<string, string>> {
  const ids = [...new Set(retrieved.map((chunk) => chunk.documentId))];
  if (ids.length === 0) return new Map();

  const rows = await withUser(userId, (tx) =>
    tx
      .select({ id: documents.id, name: documents.name })
      .from(documents)
      .where(inArray(documents.id, ids)),
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

function simpleStream(events: Array<[string, unknown]>): Response {
  const encoder = new TextEncoder();
  const body = events.map(([name, data]) => encodeEvent(name, data)).join("");
  return new Response(encoder.encode(body), { headers: sseHeaders() });
}

function generationStream(args: {
  session: SessionUser;
  threadId: string;
  prompt: ChatMessage[];
  apiKey: string;
  model: string;
  search: { chunks: RetrievedChunk[]; bm25Only: boolean };
  documentNames: Map<string, string>;
  streamFn: (options: {
    apiKey: string;
    model: string;
    messages: ChatMessage[];
  }) => AsyncGenerator<LlmStreamEvent>;
}): Response {
  const encoder = new TextEncoder();
  const { session, threadId, prompt, apiKey, model, search, documentNames, streamFn } = args;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      let tokensIn = 0;
      let tokensOut = 0;

      try {
        for await (const event of streamFn({ apiKey, model, messages: prompt })) {
          if (event.type === "token") {
            answer += event.text;
            controller.enqueue(encoder.encode(encodeEvent("token", { text: event.text })));
          } else {
            tokensIn = event.tokensIn;
            tokensOut = event.tokensOut;
          }
        }

        // reference-validity verification (ADR 0011 #5): invented citations
        // cannot ship — every emitted marker must map to a retrieved chunk
        const verification = verifyReferences(answer, search.chunks.length);
        const citationEvents: CitationEvent[] = verification.references.map((reference) => {
          const chunk = search.chunks[reference.evidenceIndex]!;
          return {
            marker: reference.marker,
            documentId: chunk.documentId,
            documentName: documentNames.get(chunk.documentId) ?? "document",
            page: chunk.page,
            section: chunk.section,
            paragraphNo: chunk.paragraphNo,
            lineStart: chunk.lineStart,
            lineEnd: chunk.lineEnd,
            span: chunk.content,
            quoteVerified: true,
          };
        });

        const estimatedTokensIn = tokensIn || estimateTokens(prompt);
        const estimatedTokensOut = tokensOut || Math.round(answer.length / 4);

        const assistantMessageId = await storeAssistantMessage(
          session.id,
          threadId,
          answer,
          verification.references.map((reference) => ({
            marker: reference.marker,
            chunkId: search.chunks[reference.evidenceIndex]!.id,
            span: search.chunks[reference.evidenceIndex]!.content,
          })),
        );

        // demo pool or BYO — every generated message is metered
        await withUser(session.id, (tx) =>
          tx.insert(apiUsage).values({
            userId: session.id,
            route: "chat",
            provider: "openrouter",
            tokensIn: estimatedTokensIn,
            tokensOut: estimatedTokensOut,
          }),
        );

        controller.enqueue(encoder.encode(encodeEvent("citations", { citations: citationEvents })));
        controller.enqueue(
          encoder.encode(
            encodeEvent("done", {
              threadId,
              messageId: assistantMessageId,
              refused: false,
              uncited: !verification.hasValidReferences,
              bm25Only: search.bm25Only,
              tokensIn: estimatedTokensIn,
              tokensOut: estimatedTokensOut,
            }),
          ),
        );
      } catch (error) {
        logger.error({ err: String(error), threadId }, "chat generation failed");
        controller.enqueue(encoder.encode(encodeEvent("error", { error: "generation-failed" })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

async function storeAssistantMessage(
  userId: string,
  threadId: string,
  content: string,
  references: Array<{ marker: number; chunkId: string; span: string }>,
): Promise<string> {
  return withUser(userId, async (tx) => {
    const [message] = await tx
      .insert(messages)
      .values({ userId, threadId, role: "assistant", content })
      .returning({ id: messages.id });
    for (const reference of references) {
      await tx.insert(citations).values({
        userId,
        messageId: message!.id,
        chunkId: reference.chunkId,
        marker: reference.marker,
        span: reference.span,
        verified: true,
      });
    }
    return message!.id;
  });
}

function estimateTokens(messageList: Array<{ content: string }>): number {
  return Math.round(messageList.reduce((sum, item) => sum + item.content.length, 0) / 4);
}
