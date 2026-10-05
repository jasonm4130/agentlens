"""Credentialed harness runners (architecture 7.2): Browser Use (class A, LLM-driven) and the
computer-use-demo driver (class B). Both need an LLM key, which comes only from 1Password:

    op run --env-file .env.op -- uv run agentlens-runner run --run-id cud-01
    op run --env-file .env.op -- uv run --with browser-use==0.13.10 \\
        agentlens-runner browser-use --runs 15

`plan` prints what a computer-use-demo run would do and needs no credentials. Every run writes
its ground-truth label line next to the verdicts the fixture records (harness/recorder/out), so
`uv run eval.py` in eval/ picks it up. Start the recorder first:
`pnpm --filter @agentlens/recorder start`.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import shlex
import sys
import time
import urllib.request
from pathlib import Path

from .labels import OUT_DIR, write_label

IMAGE = "ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest"
RECORDER = "http://127.0.0.1:8787"
FIXTURE_URL = "http://host.docker.internal:8787/?run={run_id}"
TASK = (
    "Open Firefox or Chromium at {url}. Search for 'agent detection', open the first result, "
    "scroll to the bottom, fill in all five form fields, click Save details, follow the link, "
    "and click Confirm."
)
BROWSER_USE_TASK = (
    "Go to {url}. Search for 'agent detection', open the first result, scroll to the bottom, "
    "fill in the form (name Ada Lovelace, email ada@example.com, topic engines, company "
    "Analytical, notes none), click Save details, follow the Continue link, and click Confirm."
)
DEFAULT_MODEL = "claude-opus-5-5"


def docker_command() -> list[str]:
    """The docker invocation. The task prompt is entered in the demo's UI."""
    return [
        "docker",
        "run",
        "--rm",
        "-e",
        "ANTHROPIC_API_KEY",
        "-p",
        "8501:8501",
        "-p",
        "6080:6080",
        "--add-host=host.docker.internal:host-gateway",
        IMAGE,
    ]


def task_prompt(run_id: str) -> str:
    return TASK.format(url=FIXTURE_URL.format(run_id=run_id))


def browser_use_url(run_id: str) -> str:
    return f"{RECORDER}/?run={run_id}&baselines=1"


def recorder_up(base: str = RECORDER) -> bool:
    try:
        with urllib.request.urlopen(f"{base}/", timeout=2) as r:
            return r.status == 200
    except OSError:
        return False


def need_key() -> bool:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return False
    print("ANTHROPIC_API_KEY is not set; run under `op run --env-file .env.op`.", file=sys.stderr)
    return True


def computer_use(args: argparse.Namespace) -> int:
    if args.cmd == "run":
        if need_key():
            return 2
        label = write_label(args.run_id, "computer-use-demo", "stock", Path(args.out))
        print(f"labelled {label['run']} as class B in {args.out}")
    print("1. pnpm --filter @agentlens/recorder start   (serves the fixture, records verdicts)")
    print(f"2. {shlex.join(docker_command())}")
    print(f"3. In the demo UI at http://localhost:8501, enter: {task_prompt(args.run_id)}")
    print(f"4. Verdicts land in harness/recorder/out/{args.run_id}.jsonl")
    return 0


async def _browser_use_run(run_id: str, model: str, max_steps: int) -> None:
    from browser_use import Agent, ChatAnthropic  # optional; see the module docstring

    agent = Agent(
        task=BROWSER_USE_TASK.format(url=browser_use_url(run_id)), llm=ChatAnthropic(model=model)
    )
    await agent.run(max_steps=max_steps)


def browser_use(args: argparse.Namespace) -> int:
    if need_key():
        return 2
    try:
        import browser_use  # noqa: F401
    except ImportError:
        print(
            "browser-use is not installed; run with `uv run --with browser-use==0.13.10 ...`.",
            file=sys.stderr,
        )
        return 2
    if not recorder_up():
        print(
            f"no recorder at {RECORDER}; start `pnpm --filter @agentlens/recorder start`.",
            file=sys.stderr,
        )
        return 2
    # Stock Browser Use (highlights on); only its own analytics ping is turned off.
    os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")
    prefix = args.prefix or f"browser-use-{time.strftime('%Y%m%d%H%M')}"
    for i in range(1, args.runs + 1):
        run_id = f"{prefix}-{i:02d}"
        write_label(run_id, "browser-use", f"stock, highlights on, {args.model}", Path(args.out))
        asyncio.run(_browser_use_run(run_id, args.model, args.max_steps))
        print(f"{run_id}: done; verdicts in {args.out}/{run_id}.jsonl")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="agentlens-runner")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("plan", "run"):
        s = sub.add_parser(name, help="computer-use-demo (class B)")
        s.add_argument("--run-id", required=True)
        s.add_argument("--out", default=str(OUT_DIR))
    b = sub.add_parser("browser-use", help="Browser Use, stock (class A)")
    b.add_argument("--runs", type=int, default=1)
    b.add_argument("--prefix")
    b.add_argument("--model", default=DEFAULT_MODEL)
    b.add_argument("--max-steps", type=int, default=40)
    b.add_argument("--out", default=str(OUT_DIR))
    args = p.parse_args(argv)
    return browser_use(args) if args.cmd == "browser-use" else computer_use(args)


if __name__ == "__main__":
    raise SystemExit(main())
