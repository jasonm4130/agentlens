"""computer-use-demo driver (class B).

M0 scaffold: `plan` prints what a run would do and needs no credentials. `run` refuses to start
unless ANTHROPIC_API_KEY is present, and even then only prints the docker command, because the
live runs are the captain's to start (M0 acceptance b and c). Secrets come from 1Password:

    op run --env-file .env.op -- uv run agentlens-runner run --run-id <id>
"""

from __future__ import annotations

import argparse
import os
import shlex
import sys

IMAGE = "ghcr.io/anthropics/anthropic-quickstarts:computer-use-demo-latest"
FIXTURE_URL = "http://host.docker.internal:8787/?run={run_id}"
TASK = (
    "Open Firefox or Chromium at {url}. Search for 'agent detection', open the first result, "
    "scroll to the bottom, fill in all five form fields, click Save details, follow the link, "
    "and click Confirm."
)


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


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="agentlens-runner")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("plan", "run"):
        s = sub.add_parser(name)
        s.add_argument("--run-id", required=True)
    args = p.parse_args(argv)

    if args.cmd == "run" and not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "ANTHROPIC_API_KEY is not set; run under `op run --env-file .env.op`.", file=sys.stderr
        )
        return 2

    print("1. pnpm --filter @agentlens/recorder start   (serves the fixture, records verdicts)")
    print(f"2. {shlex.join(docker_command())}")
    print(f"3. In the demo UI at http://localhost:8501, enter: {task_prompt(args.run_id)}")
    print(f"4. Verdicts land in harness/recorder/out/{args.run_id}.jsonl")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
