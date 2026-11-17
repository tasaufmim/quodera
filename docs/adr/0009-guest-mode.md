# ADR 0009: Guest mode as ghost accounts (one-click trial workspace)

- **Status:** accepted
- **Date:** 2026-11-17

## Context

The product needs a zero-friction trial: reviewers and first-time users should experience the citation UX without signup. Constraints: the tenancy model (ADR 0008) is `user_id`-based; free-tier resources (Gemini embedding quota, OpenRouter demo pool, OCR worker hours, R2 storage) are OURS, shared by all users; better-auth ships an `anonymous` plugin. Three trial shapes were considered: a shared read-only demo library, a capped guest workspace, and a local-only in-browser trial.

## Decision

1. Guests are ghost accounts: a real `users` row flagged `isAnonymous` (better-auth anonymous plugin), issued a standard session behind an explicit "Try as guest" click. No credentials, no PII collected.
2. Trial scope is workspace-only: guests may upload (caps: 2 documents, ≤10 pages, ≤5 MB each, 3 uploads/hour) and chat (5 msgs/day from the shared demo pool). Cloud sync and BYO-key persistence are off for guests.
3. Guest-session creation is IP-capped (3/day per IP; auth routes 10/h) — the anti-farming control. Per-guest quotas sit strictly below registered tiers everywhere.
4. Ephemeral by policy: session TTL 24h; guest data purged ≤48h via a daily Vercel cron (`/api/cron/purge-guests`, `CRON_SECRET`-guarded, admin connection) plus a lazy sweep on guest creation as backstop.
5. Upgrade path: registering from a guest session links the SAME `user_id` — trial documents and threads carry into the registered account.
6. Guest ingest runs at lower queue priority than registered users (Phase 3) to protect shared embedding quotas.

## Consequences

- Tenancy unchanged: a guest is an ordinary tenant row; `withUser()` / RLS / default-deny need no amendment. No RLS carve-out exists anywhere (this was a selection criterion).
- The quota matrix gains a guest tier; guest chat equals the registered demo quota (one constant: `GUEST_CHAT_DAILY = 5`).
- One new privileged surface: the purge cron route — `CRON_SECRET` + admin connection, the same scope as migrations, documented in SECURITY.md §8.
- Residual risk accepted: IP-capped creation does not stop VPN-rotating farmers; stakes are free-tier tokens and capped uploads, and the TTL bounds exposure (SECURITY.md documents this).
- Guest data deleted ≤48h is a stated privacy property; no PII means nothing to scrub beyond documents and threads.
- The explicit click is the consent moment for storing trial uploads.

## Alternatives considered

| Alternative                     | Why not                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Shared demo library             | requires a `visibility='public_demo'` RLS amendment punching a hole in default-deny; deferred, revisit post-MVP as its own ADR |
| Auto-provisioned guest on visit | bots mint ghost rows, burn the IP cap, and consent for storing uploads is implicit                                             |
| Local-only in-browser trial     | contradicts ADR 0002 (server-side RAG)                                                                                         |
| No trial (signup only)          | kills the CV-demo conversion the project exists for                                                                            |
