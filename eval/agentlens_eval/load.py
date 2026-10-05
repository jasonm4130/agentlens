"""Reads the recorder's JSONL (one `<run>.jsonl` per run) into one row per labelled run.

Each file holds the page's `verdict`, `signal` and `baseline` lines and one `label` line written
by the runner or the label CLI (harness/recorder/src/label.ts). Ground truth comes only from the
label line. The run's agentlens result is its last verdict (highest `seq`): session state carries
across the fixture's pages, so the last flush has seen the whole session.
"""

from __future__ import annotations

import gzip
import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import polars as pl

TIER1 = frozenset({"C-marker", "BU-marker", "webdriver", "headless-ua", "fw-globals", "BU-trio"})
FLAGGED = frozenset({"agent-likely", "agent-unattributed"})

# Mirrors GENERATORS in harness/recorder/src/label.ts.
GENERATOR_CLASS: dict[str, str | None] = {
    "playwright-headless": "A",
    "playwright-headful": "A",
    "patchright": "A",
    "browser-use": "A",
    "ghost-cursor": "A",
    "ghost-cursor-patchright": "A",
    "computer-use-demo": "B",
    "claude-in-chrome": "C",
    "atlas": "C",
    "comet": "C",
    "gemini-in-chrome": "C",
    "human": None,
}

# Mirrors HUMAN_COHORTS in harness/recorder/src/label.ts (architecture 7.3).
HUMAN_COHORTS = (
    "mouse",
    "trackpad-tap",
    "trackpad-click",
    "touch-phone",
    "keyboard-only",
    "voiceover-macos",
    "voiceover-ios",
    "voice-control",
    "dragon",
    "dictation",
    "ime",
    "password-autofill",
)

RUN_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
PSEUDONYM = re.compile(r"^P\d{2,3}$")

RUN_SCHEMA = {
    "run": pl.String,
    "truth": pl.String,
    "agent_class": pl.String,
    "generator": pl.String,
    "config": pl.String,
    "cohort": pl.String,
    "participant": pl.String,
    "task": pl.String,
    "group": pl.String,
    "label": pl.String,
    "pred_class": pl.String,
    "confidence": pl.String,
    "al_cohort": pl.String,
    "mode": pl.String,
    "flagged": pl.Boolean,
    "certain": pl.Boolean,
    "tier1": pl.Boolean,
    "rules": pl.String,
    "ruleset_version": pl.String,
    "verdicts": pl.Int64,
    "botd_flag": pl.Boolean,
    "ad_flag": pl.Boolean,
    "ad_class": pl.String,
}


def label_errors(label: dict[str, Any]) -> list[str]:
    """Why a label line would be rejected; empty when it is valid."""
    errs: list[str] = []
    gen = label.get("generator")
    if not isinstance(label.get("run"), str) or not RUN_ID.match(label["run"]):
        errs.append("bad run id")
    if gen not in GENERATOR_CLASS:
        errs.append(f"unknown generator {gen!r}")
        return errs
    cls = GENERATOR_CLASS[gen]
    if cls is None:
        if label.get("truth") != "human":
            errs.append("generator human needs truth human")
        if label.get("cohort") not in HUMAN_COHORTS:
            errs.append(f"unknown cohort {label.get('cohort')!r}")
        if not isinstance(label.get("participant"), str) or not PSEUDONYM.match(
            label["participant"]
        ):
            errs.append("participant must be a pseudonym like P01")
    else:
        if label.get("truth") != "agent":
            errs.append(f"generator {gen} needs truth agent")
        if label.get("agentClass") != cls:
            errs.append(f"generator {gen} is class {cls}")
        if "cohort" in label or "participant" in label:
            errs.append("cohort and participant are for human runs only")
    if not isinstance(label.get("group"), str) or not label["group"]:
        errs.append("missing group")
    return errs


def _lines(path: Path) -> list[dict[str, Any]]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def jsonl_files(paths: list[Path]) -> list[Path]:
    out: list[Path] = []
    for p in paths:
        if p.is_dir():
            out += sorted([*p.glob("*.jsonl"), *p.glob("*.jsonl.gz")])
        elif p.exists():
            out.append(p)
    return out


@dataclass
class Loaded:
    runs: pl.DataFrame
    features: dict[str, dict[str, Any]] = field(default_factory=dict)
    final: dict[str, dict[str, Any]] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)
    files: list[Path] = field(default_factory=list)


def _page_last(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The last non-error record per page URL, in file order."""
    last: dict[str, dict[str, Any]] = {}
    for r in records:
        if "error" not in r["payload"]:
            last[r.get("url", "")] = r["payload"]
    return last


def _summarise(run: str, lines: list[dict[str, Any]], problems: list[str]) -> dict | None:
    labels = [x for x in lines if x.get("kind") == "label"]
    if not labels:
        problems.append(f"{run}: no label line, left out")
        return None
    if len(labels) > 1:
        problems.append(f"{run}: {len(labels)} label lines, left out")
        return None
    label = labels[0]
    errs = label_errors(label)
    if label.get("run") != run:
        errs.append(f"label is for run {label.get('run')!r}")
    if errs:
        problems.append(f"{run}: invalid label ({'; '.join(errs)}), left out")
        return None

    verdicts = [x for x in lines if x.get("kind") == "verdict"]
    signals = [x for x in lines if x.get("kind") == "signal"]
    final = None
    if verdicts:
        # Highest seq wins; ties go to the later line.
        final = max(enumerate(verdicts), key=lambda iv: (iv[1]["payload"].get("seq", 0), iv[0]))[1]
    else:
        problems.append(f"{run}: no verdict recorded (counted as not flagged)")

    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for b in (x for x in lines if x.get("kind") == "baseline"):
        by_name[b["payload"].get("name", "")].append(b)
    botd = _page_last(by_name.get("botd", []))
    ad = _page_last(by_name.get("agent-detector", []))
    ad_classes = [p.get("class") for p in ad.values()]

    v = final["payload"] if final else {}
    rules = [e["rule"] for e in v.get("evidence", [])]
    label_name = v.get("label", "no-verdict")
    return {
        "run": run,
        "truth": label["truth"],
        "agent_class": label.get("agentClass"),
        "generator": label["generator"],
        "config": label.get("config"),
        "cohort": label.get("cohort"),
        "participant": label.get("participant"),
        "task": label.get("task", "fixture-flow"),
        "group": label["group"],
        "label": label_name,
        "pred_class": v.get("agentClass"),
        "confidence": v.get("confidence"),
        "al_cohort": v.get("cohort"),
        "mode": v.get("mode"),
        "flagged": label_name in FLAGGED,
        "certain": label_name == "agent-likely" and v.get("confidence") == "certain",
        "tier1": bool(signals) or any(r in TIER1 for r in rules),
        "rules": ",".join(rules),
        "ruleset_version": v.get("rulesetVersion"),
        "verdicts": len(verdicts),
        "botd_flag": any(p.get("bot") is True for p in botd.values()) if botd else None,
        "ad_flag": any(c in ("bot", "agent") for c in ad_classes) if ad else None,
        "ad_class": ",".join(sorted({str(c) for c in ad_classes})) if ad else None,
        "_final": v,
    }


def load(paths: list[Path]) -> Loaded:
    files = jsonl_files(paths)
    by_run: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in files:
        name = f.name.removesuffix(".gz").removesuffix(".jsonl")
        by_run[name] += _lines(f)
    problems: list[str] = []
    rows = []
    features: dict[str, dict[str, Any]] = {}
    final: dict[str, dict[str, Any]] = {}
    for run in sorted(by_run):
        row = _summarise(run, by_run[run], problems)
        if row is None:
            continue
        v = row.pop("_final")
        if v:
            final[run] = v
            features[run] = v.get("features", {})
        rows.append(row)
    df = pl.DataFrame(rows, schema=RUN_SCHEMA) if rows else pl.DataFrame(schema=RUN_SCHEMA)
    return Loaded(runs=df, features=features, final=final, problems=problems, files=files)
