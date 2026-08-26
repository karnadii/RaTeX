# RaTeX agent guide

This file applies to the entire repository. Keep it short and use it as a
routing guide; detailed contributor workflows belong in `CONTRIBUTING.md`,
`docs/`, or a task-specific skill.

## Repository map

- `crates/`: Rust lexer, parser, layout, shared types, renderers, and bindings.
- `platforms/`: platform packages and native integration layers.
- `tests/golden/`: formula lists, reference fixtures, and generated render output.
- `tools/`: KaTeX comparison and data-generation utilities.
- `scripts/`: repository-level build, test, and release helpers.
- `.agents/skills/`: canonical project skills.

## Working rules

- Inspect `git status` before editing and preserve unrelated user changes.
- Keep one logical change per patch. Do not edit generated data unless the task
  explicitly requires regeneration.
- Prefer targeted checks while iterating. Before handing off Rust changes, run
  `cargo fmt --all -- --check` and the narrowest relevant `cargo test` or
  `cargo clippy` command.
- Full workspace checks include GTK crates and require the system packages
  documented in `CONTRIBUTING.md`.
- When changing recursive parser or layout behavior, read
  `docs/STACK_SAFETY.md` and add the required boundary regressions.
- When changing public `DisplayList` JSON, keep
  `docs/DISPLAYLIST_JSON_PROTOCOL.md` and every affected consumer compatible.
- Update relevant documentation when behavior, public APIs, build commands, or
  release metadata changes.

## Project skills

Canonical skill content lives directly under `.agents/skills/`. Do not add
symbolic-link indirection or maintain editor- or vendor-specific skill copies.

- Use `golden-test-case` when adding or regenerating visual golden cases,
  comparing scores, or exporting diffs.
- Use `render-bench` when measuring renderer performance or comparing an
  optimization before and after.
