#!/usr/bin/env python3
"""Create a complete, indexed manifest for a RaTeX golden render run."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from corpus import read_formulas


ERROR_LINE = re.compile(r"^ERR\s+(\d+)\s+.*?\s—\s(.*)$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def classify_error(message: str) -> str:
    lowered = message.lower()
    if "parse error" in lowered:
        return "parse_error"
    if "layout error" in lowered:
        return "layout_error"
    return "render_error"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-cases", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--error-log", required=True)
    parser.add_argument("--json-out", required=True)
    parser.add_argument("--dpr", required=True, type=float)
    args = parser.parse_args()

    test_cases = Path(args.test_cases).resolve()
    output = Path(args.output).resolve()
    error_log = Path(args.error_log).resolve()
    json_out = Path(args.json_out).resolve()
    repo_root = Path(__file__).resolve().parents[2]
    lines = read_formulas(test_cases)
    errors: dict[int, str] = {}
    if error_log.exists():
        for line in error_log.read_text(encoding="utf-8", errors="replace").splitlines():
            match = ERROR_LINE.match(line)
            if match:
                errors[int(match.group(1))] = match.group(2)
    previous: dict[int, dict] = {}
    if json_out.exists():
        try:
            old = json.loads(json_out.read_text(encoding="utf-8"))
            previous = {
                int(record["index"]): record for record in old.get("cases", [])
            }
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            previous = {}

    cases = []
    for index, formula in enumerate(lines, start=1):
        png = output / f"{index:04d}.png"
        if png.exists():
            record = {
                "index": index,
                "formula": formula,
                "status": "rendered",
                "png": png.name,
                "sha256": sha256_file(png),
            }
        else:
            message = errors.get(index)
            old_record = previous.get(index, {})
            old_status = old_record.get("status")
            if message is None and old_status in {
                "parse_error",
                "layout_error",
                "render_error",
            }:
                status = old_status
                message = old_record.get("reason")
            else:
                status = classify_error(message) if message else "missing_output"
            record = {
                "index": index,
                "formula": formula,
                "status": status,
                "reason": message or "renderer produced neither a PNG nor an error record",
            }
        cases.append(record)

    manifest = {
        "manifest_version": 1,
        "kind": "ratex-render",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "test_cases": test_cases.relative_to(repo_root).as_posix(),
        "test_cases_sha256": sha256_file(test_cases),
        "dpr": args.dpr,
        "case_count": len(cases),
        "cases": cases,
    }
    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
