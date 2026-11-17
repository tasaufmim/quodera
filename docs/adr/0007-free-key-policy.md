# ADR 0007: Free-key policy — server proxy, tiny demo quota, BYO as the hero path

- **Status:** accepted
- **Date:** 2026-11-17

## Context

The plan calls for a "hardcoded free API key" so reviewers can try the product without an OpenRouter account. A key shipped in a web bundle is scraped within hours — this is the single most common way projects like this die. Separately, OpenRouter's free models have low **daily rate limits** shared by everything the key does, so an open-ended demo would exhaust the pool by breakfast. Embeddings are already free elsewhere (ADR 0004), so the key only needs chat.

## Decision

The shared OpenRouter key lives **only in server env vars** and is used exclusively by the server-side LLM proxy. It serves free models only, wrapped in a **5 messages/day per user** demo quota (Upstash counters, Phase 2) sized to preserve the daily pool for real reviewers. **BYO key is the hero path:** users who bring their own key get unlimited usage within their own limits, and their key is accepted at the proxy, used per-request, never logged, never persisted without explicit opt-in. The rate-limiter contract and per-route quota matrix are already shipped (Phase 1) so the proxy changes nothing about the HTTP surface.

## Consequences

- The demo experience survives contact with the internet; the key is rotatable via a two-step runbook (docs/ops/PROVISIONING §5).
- Expected spend: $0 forever. Spend alert at $1 as the tripwire.
- Free-model daily exhaustion is possible on viral days — the UX is an honest 429 + "bring your own key" upgrade, never a fake error.
- Every LLM call is auditable server-side (api_usage table, Phase 2), which is also what makes cost evals possible.

## Alternatives considered

| Alternative                       | Why not                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Client-side key (even obfuscated) | scraped in hours; not a risk, a certainty                                                                                 |
| Generous demo quota (20+/day)     | one crawler exhausts the free daily pool; reviewers see a broken product                                                  |
| BYO-only, no shared key           | zero abuse risk, but a CV reviewer without an OpenRouter account gets a dead demo — the exact audience this project needs |
