/**
 * The reference-validity verifier (ADR 0011 #5): every [n] marker in the
 * streamed answer must point at a chunk that was ACTUALLY retrieved —
 * invented citations are impossible to ship. (Entailment grading — does the
 * span support the sentence? — arrives with the Phase 6 eval suite; here
 * "verified" means reference-valid, stated plainly in the UI.)
 */

const MARKER_PATTERN = /\[(\d{1,3})\]/g;

export interface VerifiedReference {
  marker: number;
  /** 0-based index into the evidence array the answer was generated from. */
  evidenceIndex: number;
}

export interface VerificationResult {
  /** Distinct valid references, in order of first appearance. */
  references: VerifiedReference[];
  /** false when the answer carries no valid marker at all — the UI flags it. */
  hasValidReferences: boolean;
}

export function verifyReferences(answer: string, evidenceCount: number): VerificationResult {
  const seen = new Set<number>();
  const references: VerifiedReference[] = [];

  for (const match of answer.matchAll(MARKER_PATTERN)) {
    const marker = Number(match[1]);
    if (marker < 1 || marker > evidenceCount) continue; // hallucinated reference
    if (seen.has(marker)) continue; // one citation object per distinct marker
    seen.add(marker);
    references.push({ marker, evidenceIndex: marker - 1 });
  }

  return { references, hasValidReferences: references.length > 0 };
}
