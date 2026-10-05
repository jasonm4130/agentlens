"""Synthetic recorder JSONL for unit tests. These are shapes, not harness data: golden fixtures
and gate reports only ever come from recorded runs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest


def counts(**over: int) -> dict[str, int]:
    base = dict.fromkeys(["mouseEvents", "mouseActiveSecs", "clicks", "singleMoveClicks"], 0)
    base.update(over)
    return base


def verdict(
    label: str,
    seq: int,
    *,
    confidence: str = "medium",
    rules: tuple[str, ...] = (),
    agent_class: str | None = None,
    **count_over: int,
) -> dict[str, Any]:
    v: dict[str, Any] = {
        "label": label,
        "confidence": confidence,
        "evidence": [{"rule": r, "detail": "x"} for r in rules],
        "cohort": "mouse",
        "mode": "full",
        "features": {"counts": counts(**count_over)},
        "featuresVersion": 2,
        "rulesetVersion": "2026.10.1",
        "sessionId": "s",
        "seq": seq,
        "reason": "flush",
    }
    if agent_class:
        v["agentClass"] = agent_class
    return v


def agent_label(run: str, generator: str, cls: str) -> dict[str, Any]:
    return {
        "kind": "label",
        "run": run,
        "at": 1,
        "truth": "agent",
        "agentClass": cls,
        "generator": generator,
        "task": "fixture-flow",
        "group": generator,
    }


def human_label(run: str, cohort: str, participant: str = "P01") -> dict[str, Any]:
    return {
        "kind": "label",
        "run": run,
        "at": 1,
        "truth": "human",
        "generator": "human",
        "cohort": cohort,
        "participant": participant,
        "task": "fixture-flow",
        "group": participant,
    }


@pytest.fixture
def write_run(tmp_path: Path):
    def write(
        run: str, label: dict | None, *payloads: dict, extra: list[dict] | None = None
    ) -> Path:
        lines = [label] if label else []
        lines += [{"kind": "verdict", "run": run, "url": "/", "payload": p} for p in payloads]
        lines += extra or []
        path = tmp_path / f"{run}.jsonl"
        path.write_text("".join(json.dumps(x) + "\n" for x in lines))
        return path

    return write
