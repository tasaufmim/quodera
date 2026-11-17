# Provisioning runbook — every account, secret, and wire

Phase 1's external setup. Each section: what to create, what to copy where, how to verify. Work top to bottom once; afterwards only the checklist at the bottom matters.

## 0. Accounts table

| Service                          | Plan                 | Used for                                 | Phase                   |
| -------------------------------- | -------------------- | ---------------------------------------- | ----------------------- |
| GitHub                           | free                 | repo, CI, branch protection, CODEOWNERS  | ✅ 1                    |
| Vercel                           | Hobby                | app deploy, preview envs                 | ✅ 1                    |
| Neon                             | Free                 | Postgres 17 + pgvector (prod)            | ✅ 1 (wired in Phase 2) |
| Docker Hub / ghcr                | free                 | `pgvector/pgvector:pg17` image pulls     | ✅ 1                    |
| BetterStack                      | free                 | uptime monitor on /api/health            | ✅ 1                    |
| Upstash                          | free                 | Redis for global rate limits             | 2                       |
| Resend                           | free (100 mails/day) | SMTP: magic links, verification          | 2                       |
| Google Cloud + GitHub OAuth apps | free                 | OAuth 2.0 providers                      | 2                       |
| Cloudflare R2                    | free (10 GB)         | raw document storage                     | 2                       |
| Google AI Studio                 | free tier            | Gemini embeddings (ADR 0004)             | 3                       |
| OpenRouter                       | free models          | demo-pool chat via proxy (ADR 0007)      | 4                       |
| Render                           | free                 | Python OCR/markitdown worker (ADR 0005)  | 5                       |
| Sentry                           | free                 | error tracking (wired, activates on DSN) | ✅ 1                    |

## 1. GitHub repository

1. Create **`quodera`** (public — the git history is part of the CV artifact; keep commits clean from day one).
2. Push: `git remote add origin git@github.com:tasaufmim/quodera.git && git push -u origin main --tags`
3. Branch protection (Settings → Branches → `main`):
   - ✅ Require a pull request before merging (1 approval off — solo)
   - ✅ Require status checks: `quality`, `database`, `e2e`, `commitlint`, `gitleaks`
   - ✅ Require branches to be up to date
   - ✅ Block force pushes
4. Verify CODEOWNERS handle (`.github/CODEOWNERS`) matches your username.
5. Settings → Actions → General → Workflow permissions: **read-only** (least privilege).

## 2. Vercel

1. Import the repo (framework: Next.js — detected). Node version comes from `.node-version` (24).
2. Vercel deploys on every push to `main` (production) and every PR (preview) automatically.
3. **Recommended:** Settings → Git → check "Only build production deployments when CI passes" so broken `main` never deploys.
4. Environments: set secrets per environment (Preview/Production). Phase 1 needs none for the build itself; set `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` when created, `DATABASE_URL` in Phase 2.
5. After first deploy: set the repository **variable** `PROD_URL` (GitHub → Settings → Secrets and variables → Actions → Variables) to the production URL — `deploy-smoke.yml` probes `$PROD_URL/api/health` hourly.

## 3. Neon (production Postgres)

1. Create project `quodera` → region closest to Vercel's default region (minimize cold-start round trips).
2. Enable the **pgvector** extension (SQL editor: `CREATE EXTENSION IF NOT EXISTS vector;`) — or let migrations fail loudly until then.
3. Copy the **pooled** connection string (indirect/pooler). Pooled + `prepare:false` in our client = Neon transaction mode compatible (ADR 0003). Two roles, two URLs (ADR 0008):
   - `DATABASE_URL` → the **app role**: run migrations once locally/CI first (they bootstrap `quodera_app` with `APP_DB_PASSWORD`), then use `postgres://quodera_app:<secret>@...` in Vercel.
   - `DATABASE_ADMIN_URL` → the Neon **project owner** (migrations/fixtures only; used by `pnpm db:migrate`, never shipped to Vercel).
4. Create a branch `dev` for experimentation; `main` branch is production. CI uses ephemeral Docker Postgres, never Neon.

## 4. Local development

```bash
pnpm install
cp .env.example .env   # defaults already target the Docker DB on :5433
pnpm db:up             # pgvector/pgvector:pg17 with a healthcheck
pnpm db:migrate        # applies generated + hardening migrations
pnpm dev
```

- Postgres data persists in the `quodera_pgdata` volume; `pnpm db:down -v` wipes it.
- `pnpm test:db` runs the tenancy tests over the runtime role (`DATABASE_URL`), with fixtures on the admin role (`DATABASE_ADMIN_URL`) — both from `.env`.

## 5. Secrets manifest

`.env.example` is the source of truth for every variable name + scope. Rules:

- Local: `.env` (gitignored).
- CI: GitHub secrets/variables only (never committed).
- Vercel: environment-scoped (Preview/Production) — never "All environments" for provider keys.
- Rotation: OpenRouter key rotation is a two-step runbook — set new value in Vercel → redeploy → revoke old in OpenRouter dashboard. Keep spend alerts on the OpenRouter dashboard (alert at $1 — the demo pool should spend $0 forever).

## 6. Resend (Phase 2 — do when auth lands)

1. Add + verify your domain; set SPF/DKIM records exactly as given; DMARC `p=quarantine` to start.
2. Sender identity: `no-reply@mail.<your-domain>`.
3. `RESEND_API_KEY` → Vercel + `.env`.

## 7. OAuth apps (Phase 2)

- Google Cloud → OAuth client (Web). Authorized redirect: `<origin>/api/auth/callback/google`.
- GitHub → OAuth App. Callback: `<origin>/api/auth/callback/github`.
- Register redirect URIs against the **canonical origin** (decide the custom domain before users exist — changing later breaks saved consents).

## 8. Uptime + error tracking (Phase 1 activatable)

- BetterStack monitor: `GET <prod-url>/api/health`, 5-min interval, 2 failures = incident.
- Sentry: create project → copy DSN → `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` in Vercel → redeploy. Verify with a forced error in a preview deployment.

## First-deploy checklist

- [ ] `main` pushed, all five CI jobs green
- [ ] Vercel production deploy healthy (`/api/health` 200, version matches tag)
- [ ] `PROD_URL` variable set; deploy-smoke workflow green
- [ ] BetterStack monitor green
- [ ] Branch protection active (try pushing to `main` directly — it must fail)
- [ ] gitleaks has run on full history once
- [ ] `git tag v0.1.0` pushed
