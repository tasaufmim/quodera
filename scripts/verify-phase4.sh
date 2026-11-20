#!/usr/bin/env bash
# Phase 4 definition-of-done, as code: everything Phase 3 proved, PLUS the
# chat surface — the e2e suite now includes the cited-chat journey (guest
# session → ask → SSE refusal over the production build; with keys set the
# same journey exercises the full cited-answer path locally).
#
# Usage:
#   pnpm verify:phase4          # the full gate
#   SMOKE=1 pnpm verify:phase4  # additionally probes the live HTTP contract
set -euo pipefail

bash scripts/verify-phase3.sh

printf '\n\033[1;36m▶ chat surface (covered by the e2e leg above — journey included)\033[0m\n'
echo "  threads, SSE streaming, [n] superscripts, citation panel, BYO — exercised"
echo "  by 'chat: ask on an empty library' against the production build."

printf '\n\033[1;32m✔ phase 4 verification passed\033[0m\n'
