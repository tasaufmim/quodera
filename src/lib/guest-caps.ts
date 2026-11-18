/**
 * Guest-facing caps as ONE isomorphic source (ADR 0009) — the server's
 * UPLOAD_LIMITS builds from these numbers, and the UI displays them.
 * Isomorphic on purpose: client components may import from @/lib, never
 * from @/server (AGENTS.md import boundary).
 */
export const GUEST_CAPS = {
  /** Maximum documents a guest workspace holds. */
  documents: 2,
  /** Maximum upload size, in MiB. */
  maxMb: 5,
  /** Upload operations per hour. */
  uploadsPerHour: 3,
  /** Chat messages per day from the shared free-model pool. */
  chatDaily: 5,
  /** Guest data is deleted after this many hours (ADR 0009). */
  purgeAfterHours: 48,
} as const;
