#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PNG_ONLY=false
if [[ $# -gt 1 ]] || [[ $# -eq 1 && "$1" != "--png-only" ]]; then
  echo "Usage: $0 [--png-only]" >&2
  exit 2
fi
if [[ "${1:-}" == "--png-only" ]]; then
  PNG_ONLY=true
fi
# ratex-render / render-svg need KaTeX *.ttf (not only woff). Prefer repo `fonts/`; then
# `crates/ratex-katex-fonts/fonts/` (same files, for clone-without-root-fonts); then katex npm dist.
MARKER="KaTeX_Main-Regular.ttf"
if [[ -f "$ROOT/fonts/$MARKER" ]]; then
  FONT_DIR="$ROOT/fonts"
elif [[ -f "$ROOT/crates/ratex-katex-fonts/fonts/$MARKER" ]]; then
  FONT_DIR="$ROOT/crates/ratex-katex-fonts/fonts"
elif [[ -f "$ROOT/tools/lexer_compare/node_modules/katex/dist/fonts/$MARKER" ]]; then
  FONT_DIR="$ROOT/tools/lexer_compare/node_modules/katex/dist/fonts"
else
  FONT_DIR="$ROOT/fonts"
  echo "WARNING: $MARKER not found under fonts/, crates/ratex-katex-fonts/fonts/, or katex dist; PNG/SVG may fail or use partial fonts." >&2
fi
OUTPUT_DIR="$ROOT/tests/golden/output"
OUTPUT_CE_DIR="$ROOT/tests/golden/output_ce"
OUTPUT_SVG_DIR="$ROOT/tests/golden/output_svg"
OUTPUT_SVG_CE_DIR="$ROOT/tests/golden/output_svg_ce"
TEST_CASES="$ROOT/tests/golden/test_cases.txt"
TEST_CASE_CE="$ROOT/tests/golden/test_case_ce.txt"
TMP_ERR="$(mktemp)"
TMP_ERR_CE="$(mktemp)"
TMP_ERR_SVG="$(mktemp)"
TMP_ERR_SVG_CE="$(mktemp)"
trap 'rm -f "$TMP_ERR" "$TMP_ERR_CE" "$TMP_ERR_SVG" "$TMP_ERR_SVG_CE"' EXIT

# Faster release builds for this script only. Root `Cargo.toml` keeps full LTO + codegen-units=1
# for normal `cargo build --release` / CI; these env overrides do not change that.
export CARGO_PROFILE_RELEASE_LTO=false
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=128
export CARGO_PROFILE_RELEASE_INCREMENTAL=true

echo "Building ratex-render (release)..."
cargo build --release -p ratex-render

if [[ "$PNG_ONLY" == false ]]; then
  echo "Building ratex-svg render-svg (release, cli+standalone)..."
  cargo build --release -p ratex-svg --features cli,standalone --bin render-svg
fi

mkdir -p "$OUTPUT_DIR"
if [[ "$PNG_ONLY" == false ]]; then
  mkdir -p "$OUTPUT_SVG_DIR"
fi

echo "Clearing old PNG output..."
rm -f "$OUTPUT_DIR"/*.png
rm -f "$OUTPUT_DIR/render-manifest.json"
if [[ "$PNG_ONLY" == false ]]; then
  echo "Clearing old SVG output..."
  rm -f "$OUTPUT_SVG_DIR"/*.svg
fi

echo "Rendering formulas (PNG)..."
# Render errors are informational here: the corpus intentionally includes cases RaTeX
# does not support (e.g. \includegraphics). `|| true` keeps `set -e` from aborting on the
# binary's non-zero exit; failures are still reported from $TMP_ERR below.
cargo run --release -p ratex-render --bin render -- \
  --font-dir "$FONT_DIR" \
  --output-dir "$OUTPUT_DIR" \
  < "$TEST_CASES" 2>"$TMP_ERR" || true

if [[ "$PNG_ONLY" == false ]]; then
  echo "Rendering formulas (SVG, path glyphs)..."
  (cd "$ROOT" && cargo run --release -p ratex-svg --features cli,standalone --bin render-svg -- \
    --font-dir "$FONT_DIR" \
    --output-dir "$OUTPUT_SVG_DIR" \
    < "$TEST_CASES") 2>"$TMP_ERR_SVG" || true
fi

if [[ -s "$TMP_ERR" ]]; then
  failed_count=$(grep -c '^ERR' "$TMP_ERR" 2>/dev/null || true)
  echo ""
  echo "PNG failed: $failed_count case(s)"
  grep '^ERR' "$TMP_ERR" || true
fi

if [[ "$PNG_ONLY" == false && -s "$TMP_ERR_SVG" ]]; then
  failed_svg=$(grep -c '^ERR' "$TMP_ERR_SVG" 2>/dev/null || true)
  echo ""
  echo "SVG failed: $failed_svg case(s)"
  grep '^ERR' "$TMP_ERR_SVG" || true
fi

python3 "$ROOT/tools/golden_compare/build_render_manifest.py" \
  --test-cases "$TEST_CASES" \
  --output "$OUTPUT_DIR" \
  --error-log "$TMP_ERR" \
  --json-out "$OUTPUT_DIR/render-manifest.json" \
  --dpr 1

# ── mhchem / \\ce / \\pu suite ──────────────────────────
if [[ -f "$TEST_CASE_CE" ]]; then
  echo ""
  if [[ "$PNG_ONLY" == true ]]; then
    echo "Rendering mhchem suite (test_case_ce.txt) → output_ce/..."
  else
    echo "Rendering mhchem suite (test_case_ce.txt) → output_ce/ + output_svg_ce/..."
  fi
  rm -f "$OUTPUT_CE_DIR"/*.png
  rm -f "$OUTPUT_CE_DIR/render-manifest.json"
  mkdir -p "$OUTPUT_CE_DIR"
  if [[ "$PNG_ONLY" == false ]]; then
    rm -f "$OUTPUT_SVG_CE_DIR"/*.svg
    mkdir -p "$OUTPUT_SVG_CE_DIR"
  fi
  : >"$TMP_ERR_CE"
  : >"$TMP_ERR_SVG_CE"
  # Match KaTeX reference pixel density (Puppeteer deviceScaleFactor 2) for ink comparison.
  # If fixtures_ce were regenerated with DPR 1 (see generate_reference.mjs), use --dpr 1 here.
  cargo run --release -p ratex-render --bin render -- \
    --font-dir "$FONT_DIR" \
    --output-dir "$OUTPUT_CE_DIR" \
    --dpr 2 \
    < "$TEST_CASE_CE" 2>"$TMP_ERR_CE" || true
  if [[ "$PNG_ONLY" == false ]]; then
    (cd "$ROOT" && cargo run --release -p ratex-svg --features cli,standalone --bin render-svg -- \
      --font-dir "$FONT_DIR" \
      --output-dir "$OUTPUT_SVG_CE_DIR" \
      --dpr 2 \
      < "$TEST_CASE_CE") 2>"$TMP_ERR_SVG_CE" || true
  fi
  if [[ -s "$TMP_ERR_CE" ]]; then
    failed_ce=$(grep -c '^ERR' "$TMP_ERR_CE" 2>/dev/null || true)
    echo "mhchem PNG render errors: $failed_ce"
    grep '^ERR' "$TMP_ERR_CE" || true
  fi
  if [[ "$PNG_ONLY" == false && -s "$TMP_ERR_SVG_CE" ]]; then
    failed_svg_ce=$(grep -c '^ERR' "$TMP_ERR_SVG_CE" 2>/dev/null || true)
    echo "mhchem SVG render errors: $failed_svg_ce"
    grep '^ERR' "$TMP_ERR_SVG_CE" || true
  fi
  python3 "$ROOT/tools/golden_compare/build_render_manifest.py" \
    --test-cases "$TEST_CASE_CE" \
    --output "$OUTPUT_CE_DIR" \
    --error-log "$TMP_ERR_CE" \
    --json-out "$OUTPUT_CE_DIR/render-manifest.json" \
    --dpr 2
fi

echo "Done."
