"""Shared parsing rules for line-oriented golden formula corpora."""

from __future__ import annotations

from pathlib import Path


COMMENT_PREFIXES = ("#", "%")


def formula_lines(text: str) -> list[str]:
    formulas = []
    for line in text.splitlines():
        formula = line.strip()
        if formula and not formula.startswith(COMMENT_PREFIXES):
            formulas.append(formula)
    return formulas


def read_formulas(path: Path) -> list[str]:
    return formula_lines(path.read_text(encoding="utf-8"))
