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
  /** Guest chat (ADR 0009): shared free-model pool. */
  guestChatDaily: { limit: 5, windowSeconds: 60 * 60 * 24 },
  /** Guest uploads (ADR 0009). */
  guestUploadsPerHour: { limit: 3, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitOptions>;
