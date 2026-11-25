#!/usr/bin/env bash
# Offline integrated release validation only; invoke on bor-ai-ci-only with no-op deploy.
set -euo pipefail
if [[ "${BOR_E2E_CI_ONLY:-}" != "1" ]] || [[ $# -ne 0 ]]; then
  echo "Integrated release validation must be explicitly enabled and run without test-selection arguments." >&2
  exit 1
fi
npm ci
npm test
npm run check
npm run preview
BOR_E2E_CI_ONLY=1 bash scripts/run-browser-e2e-ci-only.sh
