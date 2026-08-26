#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="$ROOT/tests/golden/baseline.json"

"$ROOT/scripts/update_golden_output.sh" --png-only

(
  cd "$ROOT/tools/golden_compare"
  node generate_reference.mjs
)

python3 "$ROOT/tools/golden_compare/compare_golden.py" \
  --baseline-out "$BASELINE" \
  --require-manifests \
  --fail-on-missing \
  --min-coverage 1.0
