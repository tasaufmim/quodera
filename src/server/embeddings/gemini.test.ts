import { describe, expect, it } from "vitest";
import { EMBEDDING_BATCH_SIZE, EMBEDDING_DIMENSIONS } from "./index";
import { createGeminiEmbeddings } from "./gemini";

/**
 * Hermetic Gemini driver tests: fetch is mocked, no network. What's pinned:
 * batching (≤100 per call, vectors in input order), backoff-once-then-
 * succeed on 429, hard failure on 4xx, and the retry-after header being
 * honored. The REAL API contract is exercised by the ingest integration
 * suite when GEMINI_API_KEY exists (and its rate numbers go to LEARNINGS).
 */

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function okBody(count: number) {
  return {
    embeddings: Array.from({ length: count }, () => ({
      values: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i),
    })),
  };
}

const withKey = { apiKey: "test-key" };

describe("createGeminiEmbeddings", () => {
  it("batches at 100 inputs per call and preserves input order", async () => {
    const calls: number[] = [];
    const provider = createGeminiEmbeddings({
      ...withKey,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { requests: unknown[] };
        calls.push(body.requests.length);
        return fakeResponse(200, okBody(body.requests.length));
      },
    });

    const texts = Array.from({ length: 250 }, (_, i) => `text ${i}`);
    const vectors = await provider.embed(texts, "RETRIEVAL_DOCUMENT");

    expect(calls).toEqual([EMBEDDING_BATCH_SIZE, EMBEDDING_BATCH_SIZE, 50]);
    expect(vectors).toHaveLength(250);
    expect(vectors.every((v) => v.length === EMBEDDING_DIMENSIONS)).toBe(true);
  });

  it("retries a 429 once and succeeds (honoring retry-after)", async () => {
    const slept: number[] = [];
    let attempts = 0;
    const provider = createGeminiEmbeddings({
      ...withKey,
      fetchImpl: async () => {
        attempts++;
        if (attempts === 1) {
          return fakeResponse(429, { error: "quota" }, { "retry-after": "2" });
        }
        return fakeResponse(200, okBody(1));
      },
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    const vectors = await provider.embed(["a"], "RETRIEVAL_QUERY");

    expect(vectors).toHaveLength(1);
    expect(slept).toEqual([2000]); // retry-after: 2 → 2000ms
  });

  it("fails fast on a client error (no retries, no sleep)", async () => {
    const provider = createGeminiEmbeddings({
      ...withKey,
      fetchImpl: async () => fakeResponse(400, { error: "bad request" }),
      sleep: async () => {
        throw new Error("must not sleep on 4xx");
      },
    });

    await expect(provider.embed(["a"], "RETRIEVAL_DOCUMENT")).rejects.toThrow(/400/);
  });

  it("gives up after max attempts on persistent 429s", async () => {
    let attempts = 0;
    const provider = createGeminiEmbeddings({
      ...withKey,
      fetchImpl: async () => {
        attempts++;
        return fakeResponse(429, { error: "quota" });
      },
      sleep: async () => {},
    });

    await expect(provider.embed(["a"], "RETRIEVAL_DOCUMENT")).rejects.toThrow(/attempt 3/);
    expect(attempts).toBe(3);
  });

  it("refuses to call the API without a key", async () => {
    const provider = createGeminiEmbeddings({
      apiKey: undefined,
      fetchImpl: async () => {
        throw new Error("must not be called");
      },
    });
    await expect(provider.embed(["a"], "RETRIEVAL_DOCUMENT")).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
