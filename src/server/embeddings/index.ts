/**
 * The embedding provider surface (ADR 0004 postscript): ONE interface, ONE
 * model for everyone. Queries and documents embed through the same provider
 * with different task types (Phase 4 uses RETRIEVAL_QUERY for questions).
 *
 * Without GEMINI_API_KEY the provider is unconfigured — ingest fails
 * documents honestly with `embedding-unavailable` rather than pretending.
 */

export const EMBEDDING_MODEL = "gemini-embedding-001";
/** Permanent: the chunks table's vector column matches this exactly. */
export const EMBEDDING_DIMENSIONS = 768;
/** Gemini batchEmbedContents accepts up to 100 requests per call. */
export const EMBEDDING_BATCH_SIZE = 100;

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface EmbeddingProvider {
  /**
   * Embed `texts` with the given task type; returns vectors in input order.
   * Implementations batch internally; callers never see batch boundaries.
   */
  embed(texts: string[], taskType: EmbeddingTaskType): Promise<number[][]>;
}

export interface BatchReport {
  /** Number of batchEmbedContents calls made (metering + quota units). */
  batches: number;
  /** Estimated tokens (chars/4) across all inputs. */
  estimatedTokens: number;
}
