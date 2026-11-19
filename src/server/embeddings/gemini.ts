import { env } from "@/server/lib/env";
import { logger } from "@/server/lib/logger";
import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  type BatchReport,
  type EmbeddingProvider,
  type EmbeddingTaskType,
} from "./index";

/**
 * Gemini `batchEmbedContents` driver (ADR 0004 postscript):
 *  - batches of ≤100 inputs per HTTP call
 *  - retry with exponential backoff on 429/5xx (max 3 attempts), honoring
 *    Retry-After when present — the free tier's rate caps are the real
 *    constraint, and the empirical numbers get recorded in LEARNINGS
 *  - injectable fetch for hermetic unit tests
 */

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;

export interface GeminiEmbeddingsOptions {
  fetchImpl?: typeof fetch;
  /** Max attempts per batch (default 3). */
  maxAttempts?: number;
  /** Injectable sleeper for backoff tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable key (defaults to the env snapshot) — for tests. */
  apiKey?: string;
}

export function createGeminiEmbeddings(options: GeminiEmbeddingsOptions = {}): EmbeddingProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? 3;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const apiKey = options.apiKey ?? env.GEMINI_API_KEY;

  return {
    async embed(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set — embeddings unavailable");
      }

      const vectors: number[][] = [];
      let batches = 0;

      for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
        const slice = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
        const embeddings = await embedBatch(slice, taskType);
        batches++;
        vectors.push(...embeddings);
      }

      lastBatchReport = {
        batches,
        estimatedTokens: estimateTokens(texts),
      };
      return vectors;
    },
  };

  async function embedBatch(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]> {
    const body = JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS,
      })),
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetchImpl(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey as string,
        },
        body,
      });

      if (response.ok) {
        const json = (await response.json()) as { embeddings?: Array<{ values?: number[] }> };
        const values = json.embeddings?.map((entry) => entry.values ?? []);
        if (!values || values.length !== texts.length || values.some((v) => v.length === 0)) {
          throw new Error("Gemini batchEmbedContents returned a malformed payload");
        }
        return values;
      }

      // rate limits and server-side blips are retryable; client errors are not
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`Gemini embeddings rejected the request (${response.status})`);
      }

      lastError = new Error(`Gemini embeddings ${response.status} (attempt ${attempt})`);
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      const backoff = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
      if (attempt < maxAttempts) {
        logger.warn({ backoffMs: backoff }, "embedding batch throttled — backing off");
        await sleep(backoff);
      }
    }
    throw lastError;
  }
}

function estimateTokens(texts: string[]): number {
  return Math.round(texts.reduce((sum, text) => sum + text.length, 0) / 4);
}

/** The most recent embed() call's metering data — read by the ingest orchestrator. */
let lastBatchReport: BatchReport | null = null;

export function takeLastBatchReport(): BatchReport | null {
  const report = lastBatchReport;
  lastBatchReport = null;
  return report;
}
