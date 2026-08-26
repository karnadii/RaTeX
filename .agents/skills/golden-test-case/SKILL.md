---
name: golden-test-case
description: >-
  Add golden test cases under tests/golden, regenerate RaTeX output and KaTeX
  reference fixtures, run ink-based scoring with compare_golden.py, and export
  diff images when needed. Use when adding or updating golden tests, inspecting
  scores, or debugging render mismatches.
---

# Golden test cases and scoring workflow

## Prerequisites

- **RaTeX output**: `scripts/update_golden_output.sh` needs a Rust toolchain; PNG/SVG need KaTeX TTFs under `fonts/` (script falls back to `tools/lexer_compare/node_modules/katex/dist/fonts`).
- **KaTeX fixtures**: run `npm install` in `tools/golden_compare` (Puppeteer + `katex` dist, including `contrib/mhchem.min.js`).
- **Compare script**: `python3 tools/golden_compare/compare_golden.py` needs `pip install Pillow numpy`.

## 1. Add test cases

- **Main suite**: edit `tests/golden/test_cases.txt` at repo root. One LaTeX formula per line; blank lines ignored; lines starting with `#` or `%` are comments.
- **mhchem (`\ce`, `\pu`, …)**: edit `tests/golden/test_case_ce.txt` with the same rules.

**Formula order** defines case indices: `0001.png` is the first non-comment
formula, `0002.png` the second, etc. (same ordering as in
`generate_reference.mjs` and `compare_golden.py`).

## 2. Generate RaTeX output and KaTeX fixtures

From repo root:

```bash
./scripts/update_golden_output.sh
```

Builds `ratex-render` / `render-svg`, writes main-suite PNGs to `tests/golden/output/` and SVGs to `tests/golden/output_svg/`; if `test_case_ce.txt` exists, also `output_ce/` and `output_svg_ce/` (mhchem uses `--dpr 2` to match reference pixel density). It also writes a complete `render-manifest.json` in each PNG output directory, so failed cases remain present as indexed status records.

Generate KaTeX reference PNGs (fixtures):

```bash
cd tools/golden_compare
node generate_reference.mjs
```

Defaults: read `tests/golden/test_cases.txt`, write `tests/golden/fixtures/`. The generator is locked to KaTeX 0.16.45 and writes `reference-manifest.json` with actual KaTeX/Puppeteer/Chromium versions, DPR, font hashes, and one status record per formula.

mhchem suite:

```bash
cd tools/golden_compare
node generate_reference.mjs ../../tests/golden/test_case_ce.txt ../../tests/golden/fixtures_ce --mhchem
```

Note: `generate_reference.mjs` and `update_golden_output.sh` regenerate from the **full** case list. New cases are usually appended; rerun a full generation so indices stay aligned with `NNNN.png` filenames.

## 3. Compare scores and diff images

From repo root:

```bash
python3 tools/golden_compare/compare_golden.py
```

Defaults: `tests/golden/fixtures/` vs `tests/golden/output/` with `tests/golden/test_cases.txt`. The Python comparator is the only authoritative score source; Rust golden tests are smoke checks. It reports every formula index, including missing, failed, and policy-excluded cases.

mhchem:

```bash
python3 tools/golden_compare/compare_golden.py --ce
```

### `compare_golden.py` arguments (reference)

Run from **repo root** so default paths resolve. All paths may be absolute or repo-relative.

| Flag | Meaning |
|------|---------|
| `--ce` / `--mhchem` | mhchem suite: fixtures `tests/golden/fixtures_ce/`, output `tests/golden/output_ce/`, cases `tests/golden/test_case_ce.txt`. |
| `--fixtures DIR` | Reference PNG directory (default: `tests/golden/fixtures`, unless `--ce`). |
| `--output DIR` | RaTeX PNG directory (default: `tests/golden/output`, unless `--ce`). |
| `--test-cases FILE` | Case list for labels in output (default: `tests/golden/test_cases.txt`, unless `--ce`). |
| `--policy FILE` | Explicit indexed exclusions. Main suite defaults to `tests/golden/policy.json`. |
| `--threshold FLOAT` | Per-case pass threshold on combined score (default `0.30`). |
| `--diff-dir DIR` | Write `NNNN_diff.png` (ref \| test \| colored diff). Creates `DIR` if missing. |
| `--diff-from N` | **Requires `--diff-dir`.** Also write diffs for every case whose **1-based** index is ≥ `N` (matches `NNNN.png` stem, e.g. `0987.png` → `N=987`). |
| `--diff-to N` | With `--diff-from`: inclusive upper bound on that same 1-based index. |
| `--json-out FILE` | Write the versioned authoritative JSON report. |
| `--csv-out FILE` | Write one flat machine-readable row per formula. |
| `--baseline-out FILE` | Write the minified version-controlled score baseline. |
| `--fail-on-missing` | Fail on unapproved missing/error cases or integrity errors. |
| `--min-coverage FLOAT` | Require eligible coverage from 0 to 1. |
| `--min-mean FLOAT` | Require the coverage-adjusted mean; unscored cases count as zero. |
| `--baseline-report FILE` | Compare matching formula occurrences with a previous JSON report. |
| `--baseline-formulas FILE` | Formula corpus belonging to a compact baseline when its suite differs from the current corpus. |
| `--max-case-regression FLOAT` | With `--baseline-report`, fail any larger per-case drop. |
| `--require-manifests` | Require generated reference/render manifests (recommended for CI and baseline updates). |

Baseline comparison matches formulas by exact source text and duplicate
occurrence order, so corpus additions, removals, and reordering do not turn
otherwise comparable formulas into integrity errors.

**Diff behavior:** With `--diff-dir` only, diffs are written for **failing** cases (combined score strictly below `--threshold`). With `--diff-from`, diffs are written for every case in the index range (not only failures).

**Copy-paste examples** (repo root):

```bash
# Diffs only for failures (main suite)
python3 tools/golden_compare/compare_golden.py --diff-dir tests/golden/diffs

# Diffs for new cases 980–988 (1-based indices; adjust to your range)
python3 tools/golden_compare/compare_golden.py \
  --diff-dir tests/golden/diffs --diff-from 980 --diff-to 988

# Stricter pass bar + mhchem + failure diffs
python3 tools/golden_compare/compare_golden.py --ce --threshold 0.35 --diff-dir tests/golden/diffs_ce
```

Add `tests/golden/diffs/` (or your chosen dir) to `.gitignore` unless the team commits diff PNGs for review.

For the compact main baseline, prefer `./scripts/update_golden_baseline.sh`.
It regenerates both image sides and writes the minified
`tests/golden/baseline.json`. Generated output, manifests, CSV, and full
diagnostic JSON are not committed; CI uploads the full report as an artifact.

## Script arguments: `update_golden_output.sh` and `generate_reference.mjs`

### `scripts/update_golden_output.sh`

- Paths are fixed inside the script (`tests/golden/test_cases.txt`, `output/`, `output_svg/`, and optionally `test_case_ce.txt` → `output_ce/`, `output_svg_ce/`).
- `--png-only` skips SVG builds/regeneration. The authoritative baseline helper and golden CI use this because the Python scorer consumes PNGs only.
- Requires repo root layout and font locations described in **Prerequisites**.

### `tools/golden_compare/generate_reference.mjs`

Usage:

```text
node generate_reference.mjs [test_cases.txt] [fixtures_dir] [--mhchem] [--manifest-out FILE]
```

| Position / flag | Meaning |
|-----------------|---------|
| `[test_cases.txt]` | Optional. Default: `tests/golden/test_cases.txt` (resolved from repo layout). |
| `[fixtures_dir]` | Optional. Default: `tests/golden/fixtures`. |
| `--mhchem` | 40px font for mhchem; use with `test_case_ce.txt` → `fixtures_ce`. |
| `--manifest-out FILE` | Override the default `<fixtures_dir>/reference-manifest.json`. |

**mhchem** (from `tools/golden_compare`):

```bash
node generate_reference.mjs ../../tests/golden/test_case_ce.txt ../../tests/golden/fixtures_ce --mhchem
```

## Quick checklist

1. Edit `test_cases.txt` (or `test_case_ce.txt`).
2. `./scripts/update_golden_output.sh`
3. `cd tools/golden_compare && node generate_reference.mjs` (mhchem: pass paths and `--mhchem`).
4. `python3 tools/golden_compare/compare_golden.py --json-out … --fail-on-missing` (mhchem: add `--ce`); use `--diff-dir` and optionally `--diff-from` / `--diff-to` for diff PNGs.
