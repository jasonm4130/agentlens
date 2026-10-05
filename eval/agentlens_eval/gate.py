"""The release gate (architecture 7.6): every check binary, evaluated against whatever runs
exist. A check with too few runs says NOT EVALUATED or INCOMPLETE, never PASS, and the gate
as a whole passes only when every gated check passes."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

import polars as pl

from .load import HUMAN_COHORTS, Loaded
from .metrics import MinimalResult, agents, humans
from .stats import Rate, rule_of_three

PASS, FAIL = "PASS", "FAIL"
NOT_EVALUATED, INCOMPLETE = "NOT EVALUATED", "INCOMPLETE"
REPORTED, NOT_RUN = "REPORTED", "NOT RUN"

# Check 3: (generator, required hits, required runs). Claude in Chrome is marker-driven; if the
# M0 persistence check fails it is restated as behavioural recall.
RECALL_GATES = (
    ("playwright-headless", 12, 15),
    ("playwright-headful", 12, 15),
    ("browser-use", 12, 15),
    ("claude-in-chrome", 8, 10),
)
# Check 5: reported, not gated, and published as known gaps.
REPORTED_GENERATORS = ("computer-use-demo", "patchright", "ghost-cursor", "ghost-cursor-patchright")

# Check 6: commands run from the repository root; each passes on exit status 0.
CORE = ["pnpm", "--filter", "@agentlens/core"]
RUNNERS = ["pnpm", "--filter", "@agentlens/runners-ts"]
COMMANDS = {
    "size": [*CORE, "exec", "size-limit", "--json"],
    "perf": [*RUNNERS, "perf", "--runs=3"],
    "privacy": [
        *[*CORE, "exec", "vitest", "run", "test/features.test.ts"],
        *["-t", "Features schema privacy"],
    ],
    "golden": [*CORE, "exec", "vitest", "run", "test/golden.test.ts"],
    "ssr": [*RUNNERS, "exec", "vitest", "run", "test/ssr.test.ts"],
    "axe": [*RUNNERS, "exec", "vitest", "run", "test/axe.test.ts"],
}
COMMAND_TITLES = {
    "size": "Bundle within the M1 size cap (size-limit)",
    "perf": "Perf trace within the 4.4 budgets",
    "privacy": "`Features` schema privacy test",
    "golden": "Golden suite",
    "ssr": "SSR import test",
    "axe": "axe clean on the fixture pages",
}


@dataclass
class CommandResult:
    ok: bool
    output: str


@dataclass
class Check:
    id: str
    title: str
    status: str
    gated: bool = True
    detail: list[str] = field(default_factory=list)


def run_commands(root: Path, only: list[str] | None = None) -> dict[str, CommandResult]:
    results: dict[str, CommandResult] = {}
    for name, cmd in COMMANDS.items():
        if only is not None and name not in only:
            continue
        p = subprocess.run(cmd, cwd=root, capture_output=True, text=True, check=False)
        results[name] = CommandResult(ok=p.returncode == 0, output=(p.stdout + p.stderr).strip())
    return results


def _tail(text: str, lines: int = 12) -> str:
    return "\n".join(text.splitlines()[-lines:])


def size_summary(output: str) -> list[str]:
    """size-limit --json output as one line per file; the raw text if it does not parse."""
    try:
        start = output.index("[")
        rows = json.loads(output[start : output.rindex("]") + 1])
        return [
            f"- {r['name']}: {r['size']} B gzip, {'within' if r.get('passed') else 'OVER'} its cap"
            for r in rows
        ]
    except (ValueError, KeyError, TypeError):
        return ["```", _tail(output), "```"]


def check_human_flags(runs: pl.DataFrame) -> Check:
    c = Check("1", "Zero human sessions flagged, in every cohort", NOT_EVALUATED)
    h = humans(runs)
    if h.is_empty():
        c.detail.append("No human sessions recorded, so nothing is bounded.")
        return c
    flagged_total = 0
    missing = []
    for cohort in HUMAN_COHORTS:
        sub = h.filter(pl.col("cohort") == cohort)
        n = len(sub)
        if n == 0:
            missing.append(cohort)
            continue
        k = int(sub["flagged"].sum())
        flagged_total += k
        c.detail.append(f"- {cohort}: {Rate(k, n)}; FPR bound {rule_of_three(k, n) or 'n/a'}")
    if flagged_total:
        c.status = FAIL
    elif missing:
        c.status = INCOMPLETE
    else:
        c.status = PASS
    if missing:
        c.detail.append(f"- No sessions yet in: {', '.join(missing)}.")
    return c


def check_tier1_humans(runs: pl.DataFrame) -> Check:
    c = Check("2", "Tier 1 rules: zero human hits", NOT_EVALUATED)
    h = humans(runs)
    if h.is_empty():
        c.detail.append("No human sessions recorded.")
        return c
    hits = h.filter(pl.col("tier1"))
    c.status = FAIL if len(hits) else PASS
    c.detail.append(f"{len(hits)} of {len(h)} human sessions hit a Tier 1 rule.")
    for r in hits.select("run", "rules").to_dicts():
        c.detail.append(f"- {r['run']}: {r['rules']}")
    return c


def check_recall(runs: pl.DataFrame) -> Check:
    c = Check("3", "Recall at agent-likely or agent-unattributed", NOT_EVALUATED)
    statuses = []
    a = agents(runs)
    for gen, need_k, need_n in RECALL_GATES:
        sub = a.filter(pl.col("generator") == gen)
        n, k = len(sub), int(sub["flagged"].sum()) if len(sub) else 0
        if n < need_n:
            s = NOT_EVALUATED
            why = f"needs {need_n} runs, has {n}"
        else:
            s = PASS if k * need_n >= need_k * n else FAIL
            why = f"needs >= {need_k}/{need_n}"
        statuses.append(s)
        c.detail.append(f"- {gen}: {s}, {Rate(k, n)} ({why})")
    if FAIL in statuses:
        c.status = FAIL
    elif all(s == PASS for s in statuses):
        c.status = PASS
    elif PASS in statuses:
        c.status = INCOMPLETE
    return c


def check_minimal(runs: pl.DataFrame, minimal: MinimalResult) -> Check:
    c = Check(
        "4",
        "Minimal baseline recall at or below ours on A and C, at equal human flags",
        NOT_EVALUATED,
    )
    if not minimal.trainable:
        c.detail.append(f"The 2607.26935 tree cannot be trained: {minimal.reason}.")
        return c
    c.detail.append(
        f"Operating point: tree threshold {minimal.threshold}, "
        f"{minimal.human_flags} human flags (ours: {minimal.max_human_flags})."
    )
    statuses = []
    for cls in ("A", "C"):
        if cls not in minimal.by_class:
            statuses.append(NOT_EVALUATED)
            c.detail.append(f"- class {cls}: no runs")
            continue
        b, o, n = minimal.by_class[cls]
        s = PASS if b <= o else FAIL
        statuses.append(s)
        c.detail.append(f"- class {cls}: {s}, baseline {Rate(b, n)} vs ours {Rate(o, n)}")
    c.status = (
        FAIL if FAIL in statuses else PASS if all(s == PASS for s in statuses) else INCOMPLETE
    )
    return c


def check_reported(runs: pl.DataFrame) -> Check:
    c = Check(
        "5", "B, Patchright and ghost-cursor recall (reported, not gated)", REPORTED, gated=False
    )
    a = agents(runs)
    for gen in REPORTED_GENERATORS:
        sub = a.filter(pl.col("generator") == gen)
        n = len(sub)
        k = int(sub["flagged"].sum()) if n else 0
        kc = int(sub["certain"].sum()) if n else 0
        c.detail.append(
            f"- {gen}: flagged {Rate(k, n)}; certain {Rate(kc, n)}" if n else f"- {gen}: no runs"
        )
    return c


def check_commands(results: dict[str, CommandResult] | None) -> list[Check]:
    out = []
    for name, title in COMMAND_TITLES.items():
        c = Check(f"6.{name}", title, NOT_RUN)
        r = (results or {}).get(name)
        if r is None:
            c.detail.append(f"Not run (`{' '.join(COMMANDS[name])}`).")
        else:
            c.status = PASS if r.ok else FAIL
            c.detail += (
                size_summary(r.output) if name == "size" else ["```", _tail(r.output), "```"]
            )
        out.append(c)
    return out


def evaluate(
    loaded: Loaded, minimal: MinimalResult, commands: dict[str, CommandResult] | None
) -> list[Check]:
    runs = loaded.runs
    return [
        check_human_flags(runs),
        check_tier1_humans(runs),
        check_recall(runs),
        check_minimal(runs, minimal),
        check_reported(runs),
        *check_commands(commands),
    ]


def passed(checks: list[Check]) -> bool:
    return all(c.status == PASS for c in checks if c.gated)
