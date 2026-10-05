"""The arXiv 2607.26935 minimal baseline: mouse event rate plus the no-move ("teleport") click
ratio, one depth-3 decision tree, trained and scored on grouped held-out splits (architecture
7.4). The paper works from raw events; agentlens keeps none, so both features are computed from
the same on-device `features` the rules see:

- mouse_event_rate: trusted mouse pointer events per active second
  (counts.mouseEvents / counts.mouseActiveSecs; 0 with no mouse activity)
- no_move_ratio: share of clicks with at most one move in the prior 300 ms
  (counts.singleMoveClicks / counts.clicks; -1 with no clicks)

A small CART (Gini, depth 3) is written out here so the baseline has no dependency beyond the
standard library and its every split can be read. Splits are leave-one-group-out: a run is only
ever scored by a tree that never saw its group (its generator for agents, its participant for
humans), as FP-Agent found held-out tasks cost up to 0.369 F1.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

FEATURE_NAMES = ("mouse_event_rate", "no_move_ratio")


def minimal_features(features: dict[str, Any]) -> tuple[float, float]:
    c = features.get("counts", {})
    secs = c.get("mouseActiveSecs", 0)
    clicks = c.get("clicks", 0)
    rate = c.get("mouseEvents", 0) / secs if secs else 0.0
    no_move = c.get("singleMoveClicks", 0) / clicks if clicks else -1.0
    return (rate, no_move)


@dataclass
class Node:
    p_agent: float
    n: int
    feature: int | None = None
    threshold: float | None = None
    left: Node | None = None
    right: Node | None = None


def _gini(ys: Sequence[int]) -> float:
    if not ys:
        return 0.0
    p = sum(ys) / len(ys)
    return 2 * p * (1 - p)


def fit(xs: Sequence[tuple[float, ...]], ys: Sequence[int], depth: int = 3) -> Node:
    """CART with Gini impurity; y is 1 for agent, 0 for human."""
    node = Node(p_agent=sum(ys) / len(ys) if ys else 0.0, n=len(ys))
    if depth == 0 or len(set(ys)) < 2:
        return node
    best: tuple[float, int, float] | None = None
    parent = _gini(ys)
    for f in range(len(xs[0])):
        values = sorted({x[f] for x in xs})
        for lo, hi in zip(values, values[1:], strict=False):
            t = (lo + hi) / 2
            left = [y for x, y in zip(xs, ys, strict=True) if x[f] <= t]
            right = [y for x, y in zip(xs, ys, strict=True) if x[f] > t]
            score = (len(left) * _gini(left) + len(right) * _gini(right)) / len(ys)
            if score < parent - 1e-12 and (best is None or score < best[0]):
                best = (score, f, t)
    if best is None:
        return node
    _, f, t = best
    li = [i for i, x in enumerate(xs) if x[f] <= t]
    ri = [i for i, x in enumerate(xs) if x[f] > t]
    node.feature, node.threshold = f, t
    node.left = fit([xs[i] for i in li], [ys[i] for i in li], depth - 1)
    node.right = fit([xs[i] for i in ri], [ys[i] for i in ri], depth - 1)
    return node


def predict(node: Node, x: tuple[float, ...]) -> float:
    while node.feature is not None and node.left and node.right:
        node = node.left if x[node.feature] <= (node.threshold or 0.0) else node.right
    return node.p_agent


def describe(node: Node, indent: str = "") -> list[str]:
    if node.feature is None or not node.left or not node.right:
        return [f"{indent}leaf: p(agent) {node.p_agent:.2f} over {node.n} runs"]
    name = FEATURE_NAMES[node.feature]
    return [
        f"{indent}{name} <= {node.threshold:.3f}:",
        *describe(node.left, indent + "  "),
        f"{indent}{name} > {node.threshold:.3f}:",
        *describe(node.right, indent + "  "),
    ]


def grouped_scores(
    xs: Sequence[tuple[float, ...]], ys: Sequence[int], groups: Sequence[str]
) -> list[float | None]:
    """Leave-one-group-out scores: each run scored by a tree trained without its group.
    None where the training side lacks a class (the tree cannot learn anything)."""
    out: list[float | None] = [None] * len(xs)
    for g in sorted(set(groups)):
        train = [i for i, gi in enumerate(groups) if gi != g]
        if len({ys[i] for i in train}) < 2:
            continue
        tree = fit([xs[i] for i in train], [ys[i] for i in train])
        for i, gi in enumerate(groups):
            if gi == g:
                out[i] = predict(tree, xs[i])
    return out


def flags_at_equal_human_flags(
    scores: Sequence[float | None], ys: Sequence[int], max_human_flags: int
) -> tuple[list[bool], float]:
    """The most permissive score threshold whose human flags do not exceed ours, so recall is
    compared at equal human flags (7.6 check 4). Unscored runs are never flagged."""
    candidates = sorted({s for s in scores if s is not None}, reverse=True)
    threshold = float("inf")
    for t in candidates:
        human_flags = sum(
            1 for s, y in zip(scores, ys, strict=True) if y == 0 and s is not None and s >= t
        )
        if human_flags > max_human_flags:
            break
        threshold = t
    return [s is not None and s >= threshold for s in scores], threshold
