"""Golden fixtures (architecture 7.5): every labelled run's final `features` with the label the
library gave it. packages/core/test/golden.test.ts re-scores each one with the current ruleset
on every commit, so a ruleset change that flips a label fails CI until the fixture is updated in
the same commit, with a reason recorded in its `changes` list."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .load import Loaded


def fixture(run: str, row: dict[str, Any], verdict: dict[str, Any]) -> dict[str, Any]:
    truth = {
        k: row[k]
        for k in ("truth", "agent_class", "generator", "config", "cohort", "task")
        if row.get(k)
    }
    expected: dict[str, Any] = {"label": verdict["label"], "confidence": verdict["confidence"]}
    if verdict.get("agentClass"):
        expected["agentClass"] = verdict["agentClass"]
    rules = [e["rule"] for e in verdict.get("evidence", [])]
    return {
        "run": run,
        "truth": truth,
        "mode": verdict["mode"],
        "gpc": "gpc" in rules,
        "rulesetVersion": verdict["rulesetVersion"],
        "featuresVersion": verdict["featuresVersion"],
        "expected": expected,
        "changes": [],
        "features": verdict["features"],
    }


def write_golden(loaded: Loaded, out: Path, overwrite: bool = False) -> list[Path]:
    """Writes `<out>/<run>.json` for each labelled run with a verdict. Existing fixtures are
    kept unless `overwrite`, since a fixture's `expected` is only ever changed deliberately."""
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for row in loaded.runs.to_dicts():
        run = row["run"]
        verdict = loaded.final.get(run)
        path = out / f"{run}.json"
        if verdict is None or (path.exists() and not overwrite):
            continue
        path.write_text(json.dumps(fixture(run, row, verdict), indent=2) + "\n", encoding="utf8")
        written.append(path)
    return written
