"""Credentialed harness runners (architecture 7.2): Browser Use (class A, LLM-driven) and the
computer-use-demo driver (class B). Both need an LLM key, which comes only from 1Password:

    op run --env-file .env.op -- uv run agentlens-runner run --run-id cud-01
    op run --env-file .env.op -- uv run --with browser-use==0.13.10 \\
        agentlens-runner browser-use --runs 15

Browser Use can also go through OpenRouter (`--provider openrouter`, key in OPENROUTER_API_KEY,
OpenRouter model ids such as anthropic/claude-sonnet-5).

`plan` prints what a computer-use-demo run would do and needs no credentials. Every run writes
its ground-truth label line next to the verdicts the fixture records (harness/recorder/out), so
`uv run eval.py` in eval/ picks it up. Start the recorder first:
`pnpm --filter @agentlens/recorder start`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shlex
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

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
OPENROUTER_BASE = "https://openrouter.ai/api"
# Browser Use providers: the key each one reads and its default model id.
PROVIDERS = {
    "anthropic": ("ANTHROPIC_API_KEY", DEFAULT_MODEL),
    # Opus 5.5 declines Browser Use's agent prompt (refusal category reasoning_extraction).
    "openrouter": ("OPENROUTER_API_KEY", "anthropic/claude-sonnet-5"),
}


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


def need_key(var: str = "ANTHROPIC_API_KEY") -> bool:
    if os.environ.get(var):
        return False
    hint = "run under `op run --env-file .env.op`" if var == "ANTHROPIC_API_KEY" else "export it"
    print(f"{var} is not set; {hint}.", file=sys.stderr)
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


def drop_null_cache_control(value: Any) -> Any:
    """Browser Use sends `cache_control: null` on content blocks. Anthropic ignores it, but
    OpenRouter's request validator rejects the whole request, so the key is dropped."""
    if isinstance(value, dict):
        return {
            k: drop_null_cache_control(v)
            for k, v in value.items()
            if not (k == "cache_control" and v is None)
        }
    if isinstance(value, list):
        return [drop_null_cache_control(v) for v in value]
    return value


def response_cost(body: bytes) -> float:
    """The USD cost OpenRouter reports in a Messages response (0 when absent)."""
    try:
        usage = json.loads(body).get("usage") or {}
    except (ValueError, AttributeError):
        return 0.0
    return float(usage.get("cost") or 0)


def _openrouter_http_client(spend: dict[str, float]) -> Any:
    """Cleans each request for OpenRouter and adds each response's cost to spend["usd"]."""
    import httpx  # a Browser Use dependency

    class Transport(httpx.AsyncHTTPTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            messages = request.method == "POST" and request.url.path.endswith("/messages")
            if messages:
                body = json.dumps(drop_null_cache_control(json.loads(request.content)))
                headers = [(k, v) for k, v in request.headers.items() if k != "content-length"]
                request = httpx.Request(
                    "POST",
                    request.url,
                    headers=headers,
                    content=body.encode(),
                    extensions=request.extensions,
                )
            response = await super().handle_async_request(request)
            if messages:
                spend["usd"] += response_cost(await response.aread())
            return response

    return httpx.AsyncClient(transport=Transport(), timeout=httpx.Timeout(600, connect=10))


async def _browser_use_run(
    run_id: str, provider: str, model: str, max_steps: int, spend: dict[str, float]
) -> None:
    from browser_use import Agent, ChatAnthropic  # optional; see the module docstring

    # A thinking config makes Browser Use ask with tool_choice auto: the 5.5 models reject the
    # forced tool choice it sends otherwise. OpenRouter is reached on its Anthropic-compatible
    # endpoint, because its OpenAI-style route sends Browser Use's schema as strict output,
    # which Anthropic rejects as too large.
    route = {}
    if provider == "openrouter":
        route = {
            "base_url": OPENROUTER_BASE,
            "auth_token": os.environ["OPENROUTER_API_KEY"],
            "http_client": _openrouter_http_client(spend),
        }
    llm = ChatAnthropic(model=model, thinking={"type": "adaptive"}, **route)
    agent = Agent(task=BROWSER_USE_TASK.format(url=browser_use_url(run_id)), llm=llm)
    await agent.run(max_steps=max_steps)


def browser_use(args: argparse.Namespace) -> int:
    key_var, default_model = PROVIDERS[args.provider]
    if need_key(key_var):
        return 2
    model = args.model or default_model
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
    spend = {"usd": 0.0}
    for i in range(args.start, args.start + args.runs):
        if args.budget is not None and spend["usd"] >= args.budget:
            print(
                f"budget ${args.budget:.2f} reached after ${spend['usd']:.4f}; stopping before {i}"
            )
            return 3
        run_id = f"{prefix}-{i:02d}"
        via = "" if args.provider == "anthropic" else f" via {args.provider}"
        write_label(run_id, "browser-use", f"stock, highlights on, {model}{via}", Path(args.out))
        before = spend["usd"]
        asyncio.run(_browser_use_run(run_id, args.provider, model, args.max_steps, spend))
        print(f"{run_id}: done; verdicts in {args.out}/{run_id}.jsonl")
        if args.provider == "openrouter":
            cost, total = spend["usd"] - before, spend["usd"]
            print(f"{run_id}: OpenRouter cost ${cost:.4f}, ${total:.4f} so far")
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
    b.add_argument(
        "--start", type=int, default=1, help="number of the first run (to resume a series)"
    )
    b.add_argument("--provider", choices=sorted(PROVIDERS), default="anthropic")
    b.add_argument(
        "--model", help="default: claude-opus-5-5 (anthropic/claude-sonnet-5 on openrouter)"
    )
    b.add_argument("--max-steps", type=int, default=40)
    b.add_argument("--budget", type=float, help="OpenRouter USD to stop at, checked between runs")
    b.add_argument("--out", default=str(OUT_DIR))
    args = p.parse_args(argv)
    return browser_use(args) if args.cmd == "browser-use" else computer_use(args)


if __name__ == "__main__":
    raise SystemExit(main())
