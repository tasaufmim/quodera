import type { RateLimitOptions } from "./index";

/**
 * The quota matrix (ADR 0007 / ADR 0009) — the ONLY place limits are defined.
 * Enforced via getLimiter() (Upstash when configured, memory fallback); see
 * docs/ops/PROVISIONING.md §9. Env-tunable values arrive when there is an
 * operator reason to tune them — the discipline is "no scattered literals".
 */
export const POLICY = {
  /** demo-limited reference route (proves the contract end-to-end). */
  demo: { limit: 3, windowSeconds: 30 },
  /** Sensitive auth routes: magic-link requests, OAuth starts/returns. 10/hour per IP. */
  authSensitive: { limit: 10, windowSeconds: 60 * 60 },
  /** Guest-session creation (ADR 0009): the anti-farming guard. 3/day per IP. */
  guestCreation: { limit: 3, windowSeconds: 60 * 60 * 24 },
  /**
   * The shared free-model demo pool (ADR 0007/0009): guests AND registered
   * demo users, 5 messages/day — sized under OpenRouter's 50 RPD free-tier
   * cap so the pool can never be drained by one user.
   */
  demoChatDaily: { limit: 5, windowSeconds: 60 * 60 * 24 },
  /** BYO-key chat: unlimited by their own plan, infra-guarded 60/hour. */
  byoChatPerHour: { limit: 60, windowSeconds: 60 * 60 },
  /** Guest uploads (ADR 0009). */
  guestUploadsPerHour: { limit: 3, windowSeconds: 60 * 60 },
  /** Registered uploads: fair-use rate guard. */
  uploadsPerHour: { limit: 20, windowSeconds: 60 * 60 },
  /**
   * Embedding batch quota (ADR 0004 postscript): one unit = one
   * batchEmbedContents call (≤100 chunks). Free-tier RPM/RPD is the real
   * constraint; 5 batches/day covers several guest documents, 50/day is
   * generous fair use for registered users.
   */
  guestEmbedBatchesDaily: { limit: 5, windowSeconds: 60 * 60 * 24 },
  embedBatchesDaily: { limit: 50, windowSeconds: 60 * 60 * 24 },
} satisfies Record<string, RateLimitOptions>;
