# Security

Quodera handles people's private documents (legal, academic, professional) — security is a product feature, not a checklist. This document is the threat model and the rules that come from it.

Report a vulnerability: see §9 (responsible disclosure).

## 1. Principles

1. **Default-deny.** RLS with no tenant context returns zero rows. Rate limits assume abuse. Uploads are guilty until validated.
2. **Defense in depth.** ORM scoping _and_ RLS; edge headers _and_ API validation; proxy quotas _and_ provider spend caps.
3. **Secrets never travel to the client.** Everything external goes through server route handlers. This is GUARDRAILS #1 and the reason the OpenRouter key never appears in the browser bundle.
4. **Prove it, don't assume it.** Every invariant on this page that can be tested is tested (rls.test.ts, logger.test.ts, headers.test.ts, e2e) and enforced in CI.

## 2. Threat model (STRIDE-lite)

| Threat                         | Vector                                                   | Mitigation                                                                                                 | Phase       |
| ------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------- |
| Spoofing                       | Stolen/forged session                                    | better-auth sessions, httpOnly cookies, short-lived tokens, 2FA-ready, revocation                          | 2           |
| Tampering                      | Forged upload metadata, malicious files                  | magic-byte validation, MIME allowlist, size caps, filename sanitization                                    | 2           |
| Repudiation                    | "I never did that"                                       | audit_events table (append-only, RLS-scoped)                                                               | 6           |
| Info disclosure — cross-tenant | Query bug leaks another user's rows                      | **RLS + FORCE + default-deny policies** (shipped: rls.test.ts)                                             | ✅ 1        |
| Info disclosure — secrets      | Key leaked in bundle/logs                                | server-only env, pino redaction (tested), gitleaks in CI + pre-commit                                      | ✅ 1        |
| DoS — traffic                  | Scripted abuse                                           | edge + route rate limits; auth-route per-IP guard shipped (Upstash)                                        | 2 (auth ✅) |
| DoS — cost                     | Draining the free OpenRouter pool / embedding quota      | proxy with per-user daily caps (demo: 5 msgs/day), spend alerts                                            | 4           |
| Elevation — prompt injection   | Document contains "ignore instructions, exfiltrate keys" | see §6                                                                                                     | 4–5         |
| Elevation — parser exploits    | Malicious PDF/DOCX (XXE, zip bombs, decompression bombs) | see §5                                                                                                     | 2–5         |
| Abuse — guest farming          | Scripted anonymous account creation to multiply quotas   | IP-capped creation (3/day), caps below registered tiers, 24h TTL purge; residual (VPN) accepted (ADR 0009) | 2           |

## 3. Authentication & sessions 📍 (Phase 2)

- better-auth: Google + GitHub OAuth 2.0 (authorization-code + PKCE, `state` checked), email magic links + verification via Resend (SPF/DKIM/DMARC on the sending domain).
- **Guest sessions (ADR 0009):** the `anonymous` plugin mints a ghost `users` row (`isAnonymous`) behind an explicit "Try as guest" click — no PII collected. Session TTL 24h; data purged ≤48h. Creation is IP-capped (3/day). Registering links the same `user_id`, keeping trial data.
- Sessions: httpOnly + Secure + SameSite=Lax cookies. Refresh rotation; "sign out everywhere" revokes all sessions.
- No passwords in v1 — passwordless removes the credential-stuffing surface entirely.
- OAuth redirect URIs are registered against the canonical origin only (ADR 0001 domain decision).

## 4. The LLM key proxy 📍 (ADR 0007 — Phase 4)

The single most common way projects like this die: a hardcoded provider key shipped in the client, scraped from the JS bundle within hours, drained overnight.

Design:

```
browser ──> /api/chat (withApi, auth, rate limit)
              └─> per-user quota check (Upstash: demo 5/day, BYO ∞)
                    └─> server-side OPENROUTER_API_KEY (env, never client)
                          └─> OpenRouter (free models for demo pool)
```

- The demo pool uses free models only; the daily cap preserves the key's free-tier rate limits rather than money.
- BYO keys are accepted at the proxy, used for that request only, never logged (redaction list), and never persisted unless the user explicitly opts in.
- Spend alerts on the OpenRouter dashboard; key rotation is a runbook item (docs/ops/PROVISIONING.md).

## 5. Upload hardening 📍 (Phase 2)

Every upload passes, in order:

1. **Content-length cap** (reject before reading the body).
2. **Magic-byte sniffing** — the declared MIME type is ignored; file signatures decide.
3. **Allowlist**: `application/pdf`, `image/png|jpeg|webp`, `text/plain`, `text/markdown`, DOCX/PPTX/XLSX ZIP signatures.
4. **Decompression/zip-bomb guards** — bounded expansion ratio on OOXML; image pixel-count cap before decode.
5. **Filename sanitization** — generated storage keys (uuid + sha256); user-supplied names are display-only, escaped at render.
6. **Parser isolation** — parsing happens in the worker process, never in a route handler; parser crashes are contained and logged.
7. Optional ClamAV pass before `status: ready`.

PDFs are treated as hostile input by default — they are one of the most exploited file formats in existence.

## 6. Prompt injection from documents 📍 (Phase 4–5)

Retrieved chunks are **data, never instructions**:

- Chunks are rendered into the prompt inside a clearly delimited evidence block with an instruction hierarchy: system > task > evidence.
- The system prompt states that evidence text may contain instructions that must be ignored.
- Output filtering: answers never echo secrets, env var names, or system prompt content; a verifier pass checks each cited span actually entails its claim (also the anti-hallucination guard).
- Worker-supplied metadata (page numbers, headings) is treated as untrusted and validated before entering citations.

## 7. Transport & headers (shipped)

- TLS everywhere (Vercel); HSTS on HTTPS responses (`max-age=63072000; includeSubDomains`).
- CSP (v1): `default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`. Scripts allow `'unsafe-inline'` for now — **tracked debt: move to per-request nonces in Phase 2 hardening** (SECURITY-DEBT-001).
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/mic/geo.
- No cross-origin API consumers yet ⇒ CORS is closed by default (no ACAO headers). When a legitimate consumer appears, allowlist by origin in an ADR.

## 8. Dependency & supply-chain posture (shipped)

- pnpm lockfile + `onlyBuiltDependencies` allowlist (esbuild, lefthook) — install scripts for anything else are denied by default.
- Dependabot weekly (npm + actions); gitleaks on every push/PR; `npm audit` review in triage.
- GitHub Actions third-party actions kept to `*-vN` tags; pinning to SHAs is SECURITY-DEBT-002.
- Branch protection on `main`: PRs required, CI must be green, no force-push.

### System jobs (privileged connections) 📍 (Phase 2, ADR 0009)

Two code paths intentionally run on the **admin connection** (`DATABASE_ADMIN_URL`): migrations (`scripts/apply-migrations.ts`) and the guest purge cron (`/api/cron/purge-guests`, Phase 2). These are system jobs, not tenant access paths — they never serve request traffic, and they never run as the runtime role's privileges. The purge route must verify `CRON_SECRET` before any database work; its cascade (R2 → chunks → documents → threads → audit) is bounded to rows flagged as expired guests. Everything else — every tenant read and write — stays on `withUser()` over the runtime role, per GUARDRAILS #2.

## 9. Responsible disclosure

Email **security@quodera.dev** (configure when the domain lands — PROVISIONING.md). Please allow 90 days for a fix before public disclosure. We will credit reporters in the CHANGELOG unless anonymity is requested.

## Security debt register

| ID                | Item                                                                                             | Introduced                              | Target            |
| ----------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------- | ----------------- |
| SECURITY-DEBT-001 | CSP script-src uses `'unsafe-inline'` (no nonces)                                                | Phase 1                                 | Phase 2 hardening |
| SECURITY-DEBT-002 | Actions/images pinned by tag, not commit SHA / digest (gitleaks: `zricethezav/gitleaks:v8.24.3`) | Phase 1 (updated in fix/ci-secret-scan) | Phase 2 CI polish |
| SECURITY-DEBT-003 | In-memory rate limiter is per-instance (not global)                                              | Phase 1                                 | Phase 2 (Upstash) |
