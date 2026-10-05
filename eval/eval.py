"""agentlens offline eval (architecture 7.4-7.6) over the recorder's JSONL.

    uv run eval.py metrics [--runs DIR ...] [--out FILE]
    uv run eval.py gate    [--runs DIR ...] [--out FILE] [--commands all|none|size,ssr,...]
    uv run eval.py golden  [--runs DIR ...] [--out DIR] [--overwrite]

`--runs` defaults to harness/recorder/out. Only runs with a ground-truth label line count.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

from agentlens_eval.gate import COMMANDS, evaluate, passed, run_commands
from agentlens_eval.golden import write_golden
from agentlens_eval.load import load
from agentlens_eval.metrics import minimal_baseline
from agentlens_eval.report import gate_markdown, metrics_markdown

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RUNS = ROOT / "harness" / "recorder" / "out"


def _commit() -> str:
    def git(*args: str) -> str:
        p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)
        return p.stdout.strip()

    sha = git("rev-parse", "--short", "HEAD") or "unknown"
    return sha + (" (with uncommitted changes)" if git("status", "--porcelain") else "")


def _emit(text: str, out: str | None) -> None:
    if out:
        Path(out).write_text(text, encoding="utf8")
        print(f"wrote {out}", file=sys.stderr)
    else:
        print(text, end="")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="eval.py", description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("metrics", "gate", "golden"):
        s = sub.add_parser(name)
        s.add_argument("--runs", nargs="+", type=Path, default=[DEFAULT_RUNS])
        s.add_argument("--out")
        if name == "gate":
            s.add_argument("--commands", default="all", help="all, none, or a comma list")
        if name == "golden":
            s.add_argument("--overwrite", action="store_true")
    args = p.parse_args(argv)

    loaded = load(args.runs)
    for problem in loaded.problems:
        print(f"note: {problem}", file=sys.stderr)

    if args.cmd == "golden":
        out = Path(args.out) if args.out else ROOT / "fixtures" / "golden"
        written = write_golden(loaded, out, overwrite=args.overwrite)
        print(f"wrote {len(written)} fixtures to {out}", file=sys.stderr)
        return 0

    minimal = minimal_baseline(loaded)
    if args.cmd == "metrics":
        _emit(metrics_markdown(loaded, minimal), args.out)
        return 0

    if args.commands == "all":
        only = None
    else:
        only = [c for c in args.commands.split(",") if c and c != "none"]
    unknown = [c for c in only or [] if c not in COMMANDS]
    if unknown:
        p.error(f"unknown commands {unknown}; choose from {', '.join(COMMANDS)}")
    checks = evaluate(loaded, minimal, run_commands(ROOT, only))
    versions = sorted({v for v in loaded.runs["ruleset_version"].to_list() if v})
    header = {
        "Generated": datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
        "Commit": _commit(),
        "Ruleset versions in the runs": ", ".join(versions) or "none",
        "Run sources": ", ".join(str(r) for r in args.runs),
    }
    _emit(gate_markdown(loaded, minimal, checks, header), args.out)
    return 0 if passed(checks) else 1


if __name__ == "__main__":
    raise SystemExit(main())
