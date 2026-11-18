#!/usr/bin/env bash
# Phase 2 definition-of-done, as code: everything Phase 1 proved, PLUS the
# e2e surface (a real browser against the production build — including the
# guest journey: one click → workspace → upload → document listed).
#
# Usage:
#   pnpm verify:phase2          # the full gate
#   SMOKE=1 pnpm verify:phase2  # additionally probes the live HTTP contract
set -euo pipefail

bash scripts/verify-phase1.sh

printf '\n\033[1;36m▶ e2e (production build + real browser)\033[0m\n'
pnpm test:e2e

printf '\n\033[1;32m✔ phase 2 verification passed\033[0m\n'
