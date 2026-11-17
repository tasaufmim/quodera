## What

<!-- One or two sentences: what does this PR do? -->

## Why

<!-- The problem or decision this addresses. Link the ADR if it changes one. -->

## Checklist

<!-- Every item is a GUARDRAILS.md invariant — the review exists to enforce them. -->

- [ ] `pnpm verify:phase1` passes locally
- [ ] Tests added or updated for the behavior I changed
- [ ] New/changed inputs validated with zod (GUARDRAILS #4)
- [ ] New route handlers go through `withApi` (GUARDRAILS #3)
- [ ] New tables: RLS + FORCE + policies + tenancy tests (GUARDRAILS #2)
- [ ] No secrets/PII in logs — redaction test updated if needed (GUARDRAILS #8)
- [ ] New env vars documented in `.env.example` (app-read vars also added to `env.ts`) (GUARDRAILS #9)
- [ ] If this changed a documented decision: the ADR is updated (GUARDRAILS #10)
- [ ] Commit messages follow Conventional Commits
