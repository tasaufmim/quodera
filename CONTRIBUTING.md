# Contributing

Thanks for helping with Quodera. The short version: **small PRs, green CI, guardrails respected, docs follow decisions.**

## Setup

```bash
pnpm install
cp .env.example .env
pnpm db:up && pnpm db:migrate
pnpm dev
```

Full environment details (Node, Docker, Postgres): [docs/ops/PROVISIONING.md](docs/ops/PROVISIONING.md).

## Before you open a PR

1. `pnpm verify:phase1` passes locally (typecheck · lint · unit · db tests · build).
2. New behavior has tests — tenancy changes copy the five canary cases (docs/CODING_GUIDELINES.md §testing).
3. The [PR checklist](.github/PULL_REQUEST_TEMPLATE.md) is filled honestly — it is the GUARDRAILS.md invariants, item by item.
4. If a decision changed, the ADR changed in the same PR.

## Ground rules

- **Branches:** short-lived, Conventional Commits (enforced by hooks + CI).
- **Secrets:** never committed, never logged, never client-side. `.env.example` is the manifest; gitleaks runs on you.
- **Migrations:** forward-only; hand-written DDL goes in `migrations/hardening/` as idempotent SQL.
- **Scope:** one logical change per PR. Refactors don't ride feature PRs.
- **Questions:** open an issue before a big PR — architecture decisions happen in ADRs, not surprise diffs.

## Useful docs

[ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md) · [docs/GUARDRAILS.md](docs/GUARDRAILS.md) · [docs/CODING_GUIDELINES.md](docs/CODING_GUIDELINES.md) · [docs/adr/](docs/adr/)
