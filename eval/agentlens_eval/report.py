"""Markdown for the metrics report (`eval.py metrics`) and the gate report (`eval.py gate`)."""

from __future__ import annotations

import polars as pl

from .gate import RECALL_GATES, Check, passed
from .load import HUMAN_COHORTS, Loaded
from .metrics import (
    POWER_STATEMENT,
    MinimalResult,
    attribution_rows,
    external_baseline_rows,
    human_rows,
    md_table,
    recall_rows,
    share_rows,
)

# What a missing generator needs before it can be run (harness/README.md has the runbooks).
NEEDS = {
    "browser-use": "an LLM key for Browser Use (ANTHROPIC_API_KEY via `op run --env-file .env.op`)",
    "computer-use-demo": "ANTHROPIC_API_KEY via `op run --env-file .env.op`, Docker, an operator",
    "claude-in-chrome": "an operator with Claude in Chrome access, running hands-off",
    "human": "consenting participants (harness/human/consent.md), one session per cohort each",
}


def metrics_markdown(loaded: Loaded, minimal: MinimalResult) -> str:
    runs = loaded.runs
    parts = [
        "## Recall (agent runs)",
        "",
        md_table(
            [
                "class",
                "generator",
                "runs",
                "recall at `certain`",
                "recall at agent-likely or agent-unattributed",
            ],
            recall_rows(runs),
        ),
        "",
        "## Attribution among flagged agent runs",
        "",
        md_table(
            ["class", "generator", "flagged", "carry a class", "right class among those"],
            attribution_rows(runs),
        ),
        "",
        "## Abstain and insufficient-data share per agent class",
        "",
        md_table(
            ["class", "runs", "abstain", "insufficient-data", "no verdict recorded"],
            share_rows(runs),
        ),
        "",
        "## Human sessions per cohort",
        "",
        md_table(
            ["cohort", "sessions", "participants", "flagged", "Tier 1 hits"], human_rows(runs)
        ),
        "",
        f"**Power.** {POWER_STATEMENT}",
        "",
        "## Baselines on the same runs",
        "",
        "### BotD (@fingerprintjs/botd 2.0.0, `bot: true` on any page)",
        "",
        md_table(
            ["class", "generator", "BotD flagged", "agentlens flagged"],
            external_baseline_rows(runs, "botd_flag"),
        ),
        "",
        "### agent-detector (@doubleagent-so/agent-detector 0.3.0, class bot or agent on any page)",
        "",
        md_table(
            ["class", "generator", "agent-detector flagged", "agentlens flagged"],
            external_baseline_rows(runs, "ad_flag"),
        ),
        "",
        "### arXiv 2607.26935 minimal tree (leave-one-group-out, at agentlens's human flag count)",
        "",
    ]
    if minimal.trainable:
        parts += [
            md_table(
                ["class", "generator", "tree flagged", "agentlens flagged", "unscored"],
                minimal.rows,
            ),
            "",
            "Tree trained on every run (for reading only; the rates above use held-out groups):",
            "",
            "```",
            *minimal.tree,
            "```",
        ]
    else:
        parts.append(f"Not trainable: {minimal.reason}.")
    return "\n".join(parts) + "\n"


def missing_runs(runs: pl.DataFrame) -> list[str]:
    out = []
    counts = dict(runs.group_by("generator").len().iter_rows()) if not runs.is_empty() else {}
    for gen, _, need in RECALL_GATES:
        have = counts.get(gen, 0)
        if have < need:
            out.append(f"- {gen}: {need - have} more runs ({NEEDS.get(gen, 'no credentials')}).")
    have_c = runs.filter(pl.col("agent_class") == "C").height if not runs.is_empty() else 0
    if have_c == 0:
        out.append("- Class C runs for check 4 (Claude in Chrome above covers it).")
    if counts.get("computer-use-demo", 0) < 10:
        out.append(
            f"- computer-use-demo (class B, reported): {10 - counts.get('computer-use-demo', 0)} "
            f"more runs ({NEEDS['computer-use-demo']})."
        )
    cohorts = (
        set(runs.filter(pl.col("truth") == "human")["cohort"].to_list())
        if not runs.is_empty()
        else set()
    )
    empty = [c for c in HUMAN_COHORTS if c not in cohorts]
    if empty:
        out.append(
            "- Human sessions (7.3; about 40-60 from the owner plus 4-6 people, at least one "
            f"daily AT user) in: {', '.join(empty)} ({NEEDS['human']})."
        )
    return out


def gate_markdown(
    loaded: Loaded, minimal: MinimalResult, checks: list[Check], header: dict[str, str]
) -> str:
    runs = loaded.runs
    ok = passed(checks)
    failing = [f"{c.id} ({c.status})" for c in checks if c.gated and c.status != "PASS"]
    lines = [
        "# agentlens release gate report",
        "",
        *[f"- {k}: {v}" for k, v in header.items()],
        f"- Runs: {runs.height} labelled ({runs.filter(pl.col('truth') == 'agent').height} agent, "
        f"{runs.filter(pl.col('truth') == 'human').height} human) from {len(loaded.files)} files",
        "",
        f"**Gate: {'PASSED' if ok else 'NOT PASSED'}.**"
        + ("" if ok else f" Not passing: {', '.join(failing)}."),
        "",
        "Every check is binary (architecture 7.6). NOT EVALUATED and INCOMPLETE mean there were "
        "not enough runs to decide; they never count as a pass.",
        "",
        md_table(
            ["check", "what", "status"],
            [[c.id, c.title + ("" if c.gated else " (not gated)"), c.status] for c in checks],
        ),
        "",
    ]
    for c in checks:
        lines += [f"### {c.id}. {c.title}: {c.status}", "", *c.detail, ""]
    need = missing_runs(runs)
    if need:
        lines += ["## Runs still needed for a full gate", "", *need, ""]
    lines += ["# Metrics (architecture 7.4)", "", metrics_markdown(loaded, minimal)]
    if loaded.problems:
        lines += ["## Input problems", "", *[f"- {p}" for p in loaded.problems], ""]
    return "\n".join(lines).rstrip() + "\n"
