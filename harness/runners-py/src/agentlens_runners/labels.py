"""Ground-truth label lines, the same shape harness/recorder/src/label.ts writes and
eval/agentlens_eval/load.py validates. A run's verdicts and its label share one JSONL file."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
OUT_DIR = REPO / "harness" / "recorder" / "out"

# The generators these runners drive, with their class (architecture 7.2).
GENERATORS = {"browser-use": "A", "computer-use-demo": "B"}
RUN_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def make_label(run: str, generator: str, config: str, at: int | None = None) -> dict:
    if not RUN_ID.match(run) or run.startswith("."):
        raise ValueError(f"bad run id: {run!r}")
    if generator not in GENERATORS:
        raise ValueError(f"unknown generator: {generator!r}")
    return {
        "kind": "label",
        "run": run,
        "at": at if at is not None else int(time.time() * 1000),
        "truth": "agent",
        "generator": generator,
        "task": "fixture-flow",
        "group": generator,
        "agentClass": GENERATORS[generator],
        "config": config,
    }


def write_label(run: str, generator: str, config: str, out_dir: Path = OUT_DIR) -> dict:
    label = make_label(run, generator, config)
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / f"{run}.jsonl").open("a", encoding="utf8") as fh:
        fh.write(json.dumps(label) + "\n")
    return label
