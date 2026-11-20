import { sql } from "drizzle-orm";
import type { EmbeddingsAccess } from "@/server/embeddings/provider";
import { getEmbeddings } from "@/server/embeddings/provider";
import type { EmbeddingProvider } from "@/server/embeddings";
import { logger } from "@/server/lib/logger";
import { withUser, type Tx } from "@/server/db/rls";

/**
 * Hybrid retrieval (ADR 0011): tsvector for exact terms + pgvector cosine
 * for semantics, fused by reciprocal-rank fusion inside withUser (RLS
 * scoping is the belt under these braces).
 *
 * Degradation is honest: without GEMINI_API_KEY the vector leg skips (one
 * logged warning per process) and BM25 keeps serving. Queries are CONTENT:
 * logs carry shapes (counts, latency, refused) — never the query text.
 */

export const RETRIEVAL_DEFAULTS = {
  /** Chunks entering the prompt after fusion. */
  limit: 8,
  /** Per-leg candidate pool before fusion. */
  fetchK: 30,
  /** Standard RRF damping constant. */
  rrfK: 60,
} as const;

export interface RetrievedChunk {
  id: string;
  documentId: string;
  versionId: string;
  page: number | null;
  section: string | null;
  paragraphNo: number;
  lineStart: number | null;
  lineEnd: number | null;
  content: string;
}

export interface SearchOptions {
  /** Chunks returned after fusion (default 8). */
  limit?: number;
  /** Per-leg candidates (default 30). */
  fetchK?: number;
  /** Restrict to these documents; library-wide by default. */
  documentIds?: string[];
}

export interface SearchResult {
  /** No chunk in either leg — the assistant refuses (ADR 0011 #3). */
  refused: boolean;
  chunks: RetrievedChunk[];
  /** true when the vector leg was skipped (no embedding provider). */
  bm25Only: boolean;
}

export async function hybridSearch(
  userId: string,
  query: string,
  options: SearchOptions = {},
  embeddings: EmbeddingsAccess = getEmbeddings(),
): Promise<SearchResult> {
  const started = Date.now();
  const limit = options.limit ?? RETRIEVAL_DEFAULTS.limit;
  const fetchK = options.fetchK ?? RETRIEVAL_DEFAULTS.fetchK;

  let queryVector: number[] | null = null;
  let bm25Only = false;
  if (embeddings.available) {
    const provider = embeddings.provider();
    const [vector] = await provider.embed([query], "RETRIEVAL_QUERY");
    queryVector = vector ?? null;
  } else {
    warnOnceNoEmbeddings();
    bm25Only = true;
  }

  const result = await withUser(userId, async (tx) => {
    const keywordHits = await bm25Leg(tx, userId, query, fetchK, options.documentIds);
    const vectorHits = queryVector
      ? await vectorLeg(tx, userId, queryVector, fetchK, options.documentIds)
      : [];
    const fused = rrfFuse(keywordHits, vectorHits, limit, RETRIEVAL_DEFAULTS.rrfK);
    return { refused: fused.length === 0, chunks: fused };
  });

  logger.info(
    {
      route: "retrieval",
      refused: result.refused,
      chunks: result.chunks.length,
      bm25Only,
      durationMs: Date.now() - started,
    },
    "retrieval completed",
  );

  return { ...result, bm25Only };
}

type LegRow = RetrievedChunk & { legRank: number };

async function bm25Leg(
  tx: Tx,
  userId: string,
  query: string,
  fetchK: number,
  documentIds?: string[],
): Promise<LegRow[]> {
  // BM25-style OR semantics: every term widens the candidate pool, ranking
  // decides relevance. (plainto_tsquery ANDs every term — a query touching
  // two chunks each holding one term would refuse; caught by the tests.)
  const terms = extractTerms(query);
  if (terms.length === 0) return [];
  const tsquery = terms.join(" | ");

  const docFilter = documentIds?.length
    ? sql` and dv.document_id in (${sql.join(
        documentIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;

  const rows = await executeRows(
    tx,
    sql`
      select c.id, dv.document_id as "documentId", c.version_id as "versionId",
             c.page, c.section, c.paragraph_no as "paragraphNo",
             c.line_start as "lineStart", c.line_end as "lineEnd", c.content
      from chunks c
      join document_versions dv on dv.id = c.version_id
      where c.user_id = ${userId}
        and c.search @@ to_tsquery('english', ${tsquery})${docFilter}
      order by ts_rank(c.search, to_tsquery('english', ${tsquery})) desc
      limit ${fetchK}
    `,
  );
  return rows.map((row, index) => ({ ...toChunk(row), legRank: index + 1 }));
}

/** Sanitized alphanumeric terms, capped — to_tsquery input must be operator-free. */
function extractTerms(query: string): string[] {
  const terms = (query.match(/[a-zA-Z0-9]+/g) ?? []).map((term) => term.slice(0, 40));
  return terms.slice(0, 12);
}

async function vectorLeg(
  tx: Tx,
  userId: string,
  queryVector: number[],
  fetchK: number,
  documentIds?: string[],
): Promise<LegRow[]> {
  const vectorLiteral = JSON.stringify(queryVector);
  const docFilter = documentIds?.length
    ? sql` and dv.document_id in (${sql.join(
        documentIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;

  const rows = await executeRows(
    tx,
    sql`
      select c.id, dv.document_id as "documentId", c.version_id as "versionId",
             c.page, c.section, c.paragraph_no as "paragraphNo",
             c.line_start as "lineStart", c.line_end as "lineEnd", c.content
      from chunks c
      join document_versions dv on dv.id = c.version_id
      where c.user_id = ${userId}
        and c.embedding is not null${docFilter}
      order by c.embedding <=> ${vectorLiteral}::vector
      limit ${fetchK}
    `,
  );
  return rows.map((row, index) => ({ ...toChunk(row), legRank: index + 1 }));
}

/**
 * Reciprocal-rank fusion: score = Σ over legs of 1/(k + legRank). No
 * cross-leg normalization needed — the honest reason to prefer it over
 * weighted sums. Chunks present in BOTH legs outrank single-leg winners.
 */
export function rrfFuse(
  keyword: LegRow[],
  vector: LegRow[],
  limit: number,
  k: number,
): RetrievedChunk[] {
  const scores = new Map<string, { chunk: RetrievedChunk; score: number }>();

  for (const row of [...keyword, ...vector]) {
    const existing = scores.get(row.id);
    const contribution = 1 / (k + row.legRank);
    if (existing) {
      existing.score += contribution;
    } else {
      scores.set(row.id, {
        chunk: {
          id: row.id,
          documentId: row.documentId,
          versionId: row.versionId,
          page: row.page,
          section: row.section,
          paragraphNo: row.paragraphNo,
          lineStart: row.lineStart,
          lineEnd: row.lineEnd,
          content: row.content,
        },
        score: contribution,
      });
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.chunk);
}

type RawRow = Record<string, unknown>;

async function executeRows(tx: Tx, statement: ReturnType<typeof sql>): Promise<RawRow[]> {
  const result = (await tx.execute(statement)) as unknown;
  // drizzle's postgres-js execute returns rows directly on some versions
  // and a { rows } envelope on others — accept both, assert neither away
  if (Array.isArray(result)) return result as RawRow[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: RawRow[] }).rows;
  }
  throw new Error("unexpected execute() result shape from the postgres-js driver");
}

function toChunk(row: RawRow): RetrievedChunk {
  return {
    id: String(row.id),
    documentId: String(row.documentId),
    versionId: String(row.versionId),
    page: row.page === null ? null : Number(row.page),
    section: row.section === null ? null : String(row.section),
    paragraphNo: Number(row.paragraphNo),
    lineStart: row.lineStart === null ? null : Number(row.lineStart),
    lineEnd: row.lineEnd === null ? null : Number(row.lineEnd),
    content: String(row.content),
  };
}

let warnedNoEmbeddings = false;

function warnOnceNoEmbeddings(): void {
  if (warnedNoEmbeddings) return;
  warnedNoEmbeddings = true;
  logger.warn("no embedding provider — retrieval runs BM25-only until GEMINI_API_KEY is set");
}

export type { EmbeddingProvider };
