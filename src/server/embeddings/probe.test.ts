import { describe, expect, it } from "vitest";
import { createGeminiEmbeddings } from "./gemini";
import { EMBEDDING_DIMENSIONS } from "./index";

/**
 * The ADR 0004 postscript promise, made executable: rate caps and the live
 * contract are MEASURED, not trusted from documentation.
 *
 * Runs only when GEMINI_API_KEY is set — the moment it lands in .env, this
 * probe fires on every `pnpm test` / `pnpm verify:phase3` and its latency
 * log belongs in docs/LEARNINGS.md (first measured numbers = the entry).
 * Without the key it skips: the honest-degradation path (documents fail
 * with `embedding-unavailable`) is already fully covered elsewhere.
 */
const d = describe.skipIf(!process.env.GEMINI_API_KEY)(
  "Gemini provider probe (live — numbers to LEARNINGS)",
  () => {
    it("embeds English and Bengali text at 768 dims, finite, non-constant, distinct", async () => {
      const provider = createGeminiEmbeddings(); // uses the env key
      const texts = [
        "The tenant shall pay rent monthly in advance.",
        "দায়িত্বশীল ব্যক্তিকে প্রতি মাসে অগ্রিম ভাড়া পরিশোধ করতে হবে।", // multilingual claim, honestly tested
      ];

      const started = Date.now();
      const vectors = await provider.embed(texts, "RETRIEVAL_DOCUMENT");
      const elapsed = Date.now() - started;

      expect(vectors).toHaveLength(2);
      for (const vector of vectors) {
        expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
        expect(vector.every((value) => Number.isFinite(value))).toBe(true);
        // an all-constant vector is a broken model response, not an embedding
        expect(new Set(vector.slice(0, 16)).size).toBeGreaterThan(1);
      }
      // the two texts must produce DIFFERENT vectors (embedding sanity)
      expect(vectors[0]).not.toEqual(vectors[1]);

      // the artifact this probe exists to produce: measured round-trip
      console.log(
        `[gemini probe] ${texts.length} texts · ${EMBEDDING_DIMENSIONS} dims · ${elapsed}ms round-trip`,
      );
    });
  },
);

export { d as providerProbeSuite };
