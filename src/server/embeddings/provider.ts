import { env } from "@/server/lib/env";
import { createGeminiEmbeddings } from "./gemini";
import type { EmbeddingProvider } from "./index";

/**
 * Provider resolution (limiter/storage pattern): Gemini when the key exists,
 * explicitly unavailable otherwise — ingest fails documents honestly with
 * `embedding-unavailable` instead of pretending to index them.
 */

export const GEMINI_API_KEY_MISSING = "embedding-unavailable";

export interface EmbeddingsAccess {
  available: boolean;
  provider(): EmbeddingProvider;
}

export function getEmbeddings(): EmbeddingsAccess {
  return {
    available: Boolean(env.GEMINI_API_KEY),
    provider: () => createGeminiEmbeddings(),
  };
}
