"""The architecture 7.4 metrics over loaded runs, each rate with a Wilson 95% interval and the
rule-of-three bound at zero (or full) counts. Every function returns rows for a markdown table."""

from __future__ import annotations

from dataclasses import dataclass, field

import polars as pl

from baselines.minimal_tree import (
    describe,
    fit,
    flags_at_equal_human_flags,
    grouped_scores,
    minimal_features,
)

from .load import GENERATOR_CLASS, HUMAN_COHORTS, Loaded
from .stats import Rate

GENERATOR_ORDER = {g: i for i, g in enumerate(GENERATOR_CLASS)}
COHORT_ORDER = {c: i for i, c in enumerate(HUMAN_COHORTS)}

POWER_STATEMENT = (
    "Zero flags in n human sessions bounds the false-positive rate only below about 3/n: "
    "40 sessions give ~7.5%, 5-8 sessions in one cohort ~40-60%, 120 AT sessions ~2.5%, "
    "~1,000 AT sessions ~0.3%. The harness proves the gates work; it does not prove the "
    "false-positive rate is low."
)


def md_table(headers: list[str], rows: list[list[object]]) -> str:
    if not rows:
        return "_No runs._"
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    out += ["| " + " | ".join("" if c is None else str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def agents(runs: pl.DataFrame) -> pl.DataFrame:
    return runs.filter(pl.col("truth") == "agent")


def humans(runs: pl.DataFrame) -> pl.DataFrame:
    return runs.filter(pl.col("truth") == "human")


def _by_generator(df: pl.DataFrame, **aggs: pl.Expr) -> list[dict]:
    if df.is_empty():
        return []
    rows = df.group_by(["agent_class", "generator"]).agg(n=pl.len(), **aggs).to_dicts()
    return sorted(rows, key=lambda r: GENERATOR_ORDER.get(r["generator"], 99))


def _by_class(df: pl.DataFrame, **aggs: pl.Expr) -> list[dict]:
    if df.is_empty():
        return []
    return df.group_by("agent_class").agg(n=pl.len(), **aggs).sort("agent_class").to_dicts()


def recall_rows(runs: pl.DataFrame) -> list[list[object]]:
    """Recall per class and generator at `certain` and at agent-likely-or-unattributed."""
    a = agents(runs)
    aggs = {"certain": pl.col("certain").sum(), "flagged": pl.col("flagged").sum()}
    rows = [
        [
            r["agent_class"],
            r["generator"],
            r["n"],
            Rate(r["certain"], r["n"]),
            Rate(r["flagged"], r["n"]),
        ]
        for r in _by_generator(a, **aggs)
    ]
    rows += [
        [
            r["agent_class"],
            "**all**",
            r["n"],
            Rate(r["certain"], r["n"]),
            Rate(r["flagged"], r["n"]),
        ]
        for r in _by_class(a, **aggs)
    ]
    return rows


def attribution_rows(runs: pl.DataFrame) -> list[list[object]]:
    """Among flagged agent runs: how many carry a class, and how many carry the right one."""
    flagged = agents(runs).filter(pl.col("flagged"))
    rows = _by_generator(
        flagged,
        attributed=pl.col("pred_class").is_not_null().sum(),
        correct=(pl.col("pred_class") == pl.col("agent_class")).fill_null(False).sum(),
    )
    return [
        [
            r["agent_class"],
            r["generator"],
            r["n"],
            Rate(r["attributed"], r["n"]),
            Rate(r["correct"], r["attributed"]),
        ]
        for r in rows
    ]


def share_rows(runs: pl.DataFrame) -> list[list[object]]:
    """Abstain and insufficient-data share per agent class (gate evasion is visible, 5.2)."""
    rows = _by_class(
        agents(runs),
        abstain=(pl.col("label") == "abstain").sum(),
        insufficient=(pl.col("label") == "insufficient-data").sum(),
        missing=(pl.col("label") == "no-verdict").sum(),
    )
    return [
        [
            r["agent_class"],
            r["n"],
            Rate(r["abstain"], r["n"]),
            Rate(r["insufficient"], r["n"]),
            r["missing"],
        ]
        for r in rows
    ]


def human_rows(runs: pl.DataFrame) -> list[list[object]]:
    """Human flag count per cohort, with the 3/n bound beside every zero."""
    h = humans(runs)
    if h.is_empty():
        return []
    rows = (
        h.group_by("cohort")
        .agg(
            n=pl.len(),
            participants=pl.col("participant").n_unique(),
            flagged=pl.col("flagged").sum(),
            tier1=pl.col("tier1").sum(),
        )
        .to_dicts()
    )
    rows.sort(key=lambda r: COHORT_ORDER.get(r["cohort"], 99))
    out = [
        [r["cohort"], r["n"], r["participants"], Rate(r["flagged"], r["n"]), r["tier1"]]
        for r in rows
    ]
    total = h.select(
        n=pl.len(),
        p=pl.col("participant").n_unique(),
        f=pl.col("flagged").sum(),
        t=pl.col("tier1").sum(),
    ).row(0)
    out.append(["**all**", total[0], total[1], Rate(total[2], total[0]), total[3]])
    return out


def external_baseline_rows(runs: pl.DataFrame, column: str) -> list[list[object]]:
    """Recall per generator and human flags per cohort for a baseline recorded in the page."""
    df = runs.filter(pl.col(column).is_not_null())
    a = _by_generator(agents(df), k=pl.col(column).sum(), ours=pl.col("flagged").sum())
    rows: list[list[object]] = [
        [r["agent_class"], r["generator"], Rate(r["k"], r["n"]), Rate(r["ours"], r["n"])] for r in a
    ]
    h = humans(df)
    if not h.is_empty():
        for r in (
            h.group_by("cohort")
            .agg(n=pl.len(), k=pl.col(column).sum(), ours=pl.col("flagged").sum())
            .to_dicts()
        ):
            rows.append(["human", r["cohort"], Rate(r["k"], r["n"]), Rate(r["ours"], r["n"])])
    return rows


@dataclass
class MinimalResult:
    trainable: bool
    reason: str = ""
    threshold: float | None = None
    max_human_flags: int = 0
    human_flags: int = 0
    rows: list[list[object]] = field(default_factory=list)
    # class -> (baseline flagged, ours flagged, n)
    by_class: dict[str, tuple[int, int, int]] = field(default_factory=dict)
    tree: list[str] = field(default_factory=list)


def minimal_baseline(loaded: Loaded) -> MinimalResult:
    runs = loaded.runs.filter(pl.col("run").is_in(list(loaded.features)))
    if humans(runs).is_empty() or agents(runs).is_empty():
        return MinimalResult(
            trainable=False,
            reason="needs both human and agent runs with features; "
            f"have {len(humans(runs))} human and {len(agents(runs))} agent runs",
        )
    recs = runs.select("run", "truth", "group", "agent_class", "generator", "flagged").to_dicts()
    xs = [minimal_features(loaded.features[r["run"]]) for r in recs]
    ys = [1 if r["truth"] == "agent" else 0 for r in recs]
    groups = [r["group"] for r in recs]
    if len(set(groups)) < 2:
        return MinimalResult(trainable=False, reason="grouped splits need at least two groups")
    scores = grouped_scores(xs, ys, groups)
    ours_human_flags = sum(1 for r in recs if r["truth"] == "human" and r["flagged"])
    flags, threshold = flags_at_equal_human_flags(scores, ys, ours_human_flags)
    res = MinimalResult(
        trainable=True,
        threshold=None if threshold == float("inf") else threshold,
        max_human_flags=ours_human_flags,
        human_flags=sum(1 for f, y in zip(flags, ys, strict=True) if f and y == 0),
        tree=describe(fit(xs, ys)),
    )
    per: dict[tuple[str, str], list[int]] = {}
    for r, f, s in zip(recs, flags, scores, strict=True):
        if r["truth"] != "agent":
            continue
        key = (r["agent_class"], r["generator"])
        acc = per.setdefault(key, [0, 0, 0, 0])
        acc[0] += f
        acc[1] += r["flagged"]
        acc[2] += 1
        acc[3] += s is None
        cls = res.by_class.get(r["agent_class"], (0, 0, 0))
        res.by_class[r["agent_class"]] = (cls[0] + f, cls[1] + r["flagged"], cls[2] + 1)
    for (cls, gen), (b, o, n, unscored) in sorted(
        per.items(), key=lambda kv: GENERATOR_ORDER.get(kv[0][1], 99)
    ):
        res.rows.append([cls, gen, Rate(b, n), Rate(o, n), unscored])
    return res
