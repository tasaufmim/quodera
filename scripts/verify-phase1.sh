#!/usr/bin/env bash
# Phase 1 definition-of-done, as code (see docs/ops/PROVISIONING.md).
#
# Usage:
#   pnpm verify:phase1            # typecheck · lint · unit · db tests (if a DB is up) · build
#   SMOKE=1 pnpm verify:phase1    # additionally boots the built app and probes the HTTP contract
set -euo pipefail

# Load .env when present so the db stage can find the database; real
# environment variables always win over file values.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

say "typecheck"
pnpm typecheck

say "lint"
pnpm lint

say "unit tests"
pnpm test

say "database + RLS tenancy tests"
if [ -n "${DATABASE_URL:-}" ]; then
  # pre-flight: one actionable line instead of a wall of ECONNREFUSED traces
  if ! node -e '
    const net = require("net");
    const url = new URL(process.env.DATABASE_URL);
    const socket = net.connect(Number(url.port || 5432), url.hostname);
    socket.setTimeout(1500, () => { socket.destroy(); process.exit(1); });
    socket.on("connect", () => { socket.destroy(); process.exit(0); });
    socket.on("error", () => process.exit(1));
  ' 2>/dev/null; then
    echo "  database unreachable — start Docker and run 'pnpm db:up', then retry." >&2
    exit 1
  fi
  pnpm test:db
else
  echo "  skipped — no DATABASE_URL. Run 'pnpm db:up' and copy .env.example to .env first."
fi

say "production build"
pnpm build

if [ "${SMOKE:-0}" = "1" ]; then
  say "HTTP smoke (fresh server)"
  pnpm start &
  server_pid=$!
  trap 'kill "$server_pid" 2>/dev/null || true' EXIT

  for _ in $(seq 1 30); do
    if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  curl -fsS http://localhost:3000/api/health | grep -q '"status":"ok"' && echo "  health: ok"

  for _ in 1 2 3; do
    curl -fsS -o /dev/null http://localhost:3000/api/demo-limited
  done

  if curl -fsS -o /dev/null http://localhost:3000/api/demo-limited; then
    echo "  demo-limited: expected 429 but request succeeded" >&2
    exit 1
  fi
  echo "  demo-limited: 429 contract honored"
fi

printf '\n\033[1;32m✔ phase 1 verification passed\033[0m\n'
