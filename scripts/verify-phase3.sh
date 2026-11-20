#!/usr/bin/env bash
# Phase 3 definition-of-done, as code: everything Phase 2 proved, PLUS the
# ADR 0004 postscript promise — the live embedding contract is MEASURED
# (provider probe) rather than trusted from documentation.
#
# Usage:
#   pnpm verify:phase3          # the full gate
#   SMOKE=1 pnpm verify:phase3  # additionally probes the live HTTP contract
#
# Without GEMINI_API_KEY the probe skips with a visible explanation — the
# honest-degradation path is tested elsewhere; with the key it fires live
# and its latency log belongs in docs/LEARNINGS.md.
set -euo pipefail

bash scripts/verify-phase2.sh

printf '\n\033[1;36m▶ embedding provider probe (live when GEMINI_API_KEY is set)\033[0m\n'
pnpm vitest run src/server/embeddings/probe.test.ts
if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "  skipped — no GEMINI_API_KEY. The ingest pipeline's honest-failure path is"
  echo "  fully tested without it; this probe measures the LIVE contract."
fi

printf '\n\033[1;32m✔ phase 3 verification passed\033[0m\n'
