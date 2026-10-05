"""Rates with honest bounds (architecture 7.4): a Wilson 95% interval for every rate, and the
rule of three (3/n) when the count is zero, or 1 - 3/n when it is n."""

from __future__ import annotations

import math
from dataclasses import dataclass

Z95 = 1.959963984540054


def wilson(k: int, n: int, z: float = Z95) -> tuple[float, float]:
    """Wilson score interval for k successes in n trials; (0, 1) when n is 0."""
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def rule_of_three(k: int, n: int) -> str | None:
    """The ~95% one-sided bound for an all-or-nothing count: <=3/n at 0, >=1-3/n at n."""
    if n == 0:
        return None
    if k == 0:
        return f"<= {min(1.0, 3 / n):.1%}"
    if k == n:
        return f">= {max(0.0, 1 - 3 / n):.1%}"
    return None


@dataclass(frozen=True)
class Rate:
    k: int
    n: int

    @property
    def value(self) -> float | None:
        return self.k / self.n if self.n else None

    def __str__(self) -> str:
        if self.n == 0:
            return "n/a (0/0)"
        lo, hi = wilson(self.k, self.n)
        r3 = rule_of_three(self.k, self.n)
        bound = f"; rule of three {r3}" if r3 else ""
        return f"{self.k}/{self.n} ({self.k / self.n:.1%}; 95% CI {lo:.1%}-{hi:.1%}{bound})"
