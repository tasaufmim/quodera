# ADR 0001: Next.js 15 full-stack on TypeScript

- **Status:** accepted
- **Date:** 2026-11-17

## Context

Solo project, portfolio-grade ambition, $0 deployment, and a hard requirement that a server-side proxy exists to keep provider keys off the client (GUARDRAILS #1). The candidate stacks all had to deploy free, run CI cheaply, and support streaming (SSE) for chat.

## Decision

One Next.js 15 (App Router) application in strict TypeScript, deployed on Vercel Hobby. Route handlers are the server; `src/server/*` is the server-only perimeter. pnpm, ESLint flat config, Prettier, lefthook, Conventional Commits, Vitest, Playwright.

## Consequences

- One repo, one deploy, one CI pipeline; API and UI share types by construction.
- Vercel preview deployments give every PR a real environment for free.
- We inherit Vercel's constraints: Hobby is non-commercial (fine — portfolio), functions have timeouts (the OCR worker therefore lives on Render, ADR 0005), and edge vs Node runtimes must be respected (ARCHITECTURE §8).
- Lock-in is mild: the app is a standard Next.js app; Neon/Drizzle/R2 are portable.

## Alternatives considered

| Alternative                     | Why not                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| React SPA + Express/Fastify API | cleaner separation, but two deploys, CORS work, and double the CI glue for zero feature gain at this scale        |
| SvelteKit                       | lighter and fun, but materially fewer auth/RAG/OCR reference examples to lean on when stuck                       |
| Cloudflare Workers full-stack   | excellent free tier, but the Postgres+pgvector ecosystem story is weaker and Next.js knowledge is the CV currency |
