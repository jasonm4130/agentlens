import json
import sys

import pytest

from agentlens_runners.cli import (
    browser_use_url,
    docker_command,
    drop_null_cache_control,
    main,
    response_cost,
    task_prompt,
)
from agentlens_runners.labels import make_label


def test_run_refuses_without_api_key(monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert main(["run", "--run-id", "r1"]) == 2
    assert "ANTHROPIC_API_KEY" in capsys.readouterr().err


def test_plan_needs_no_credentials(monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert main(["plan", "--run-id", "r1"]) == 0
    assert "run=r1" in capsys.readouterr().out


def test_docker_command_forwards_key_by_name_only():
    cmd = docker_command()
    assert "ANTHROPIC_API_KEY" in cmd
    assert not any("=" in c and c.startswith("ANTHROPIC") for c in cmd)


def test_task_prompt_carries_run_id():
    assert "?run=abc" in task_prompt("abc")


def test_plan_requires_run_id():
    with pytest.raises(SystemExit):
        main(["plan"])


def test_run_with_a_key_writes_the_class_b_label(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only")
    assert main(["run", "--run-id", "cud-01", "--out", str(tmp_path)]) == 0
    label = json.loads((tmp_path / "cud-01.jsonl").read_text())
    assert label["kind"] == "label"
    assert label["generator"] == "computer-use-demo"
    assert label["agentClass"] == "B" and label["truth"] == "agent"
    assert label["group"] == "computer-use-demo"


def test_browser_use_refuses_without_api_key(monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert main(["browser-use", "--runs", "1"]) == 2
    assert "ANTHROPIC_API_KEY" in capsys.readouterr().err


def test_browser_use_explains_the_optional_install(monkeypatch, capsys):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only")
    monkeypatch.setitem(sys.modules, "browser_use", None)
    assert main(["browser-use", "--runs", "1"]) == 2
    assert "uv run --with browser-use" in capsys.readouterr().err


def test_browser_use_url_loads_the_baselines():
    assert browser_use_url("bu-01").endswith("?run=bu-01&baselines=1")


def test_labels_reject_bad_ids_and_generators():
    with pytest.raises(ValueError):
        make_label("../x", "browser-use", "stock")
    with pytest.raises(ValueError):
        make_label("ok", "human", "stock")
    assert make_label("bu-01", "browser-use", "stock", at=1)["agentClass"] == "A"


def test_browser_use_openrouter_needs_its_own_key(monkeypatch, capsys):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    assert main(["browser-use", "--provider", "openrouter"]) == 2
    assert "OPENROUTER_API_KEY" in capsys.readouterr().err


def test_browser_use_openrouter_labels_the_route_and_model(monkeypatch, tmp_path):
    from agentlens_runners import cli

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only")
    monkeypatch.setitem(sys.modules, "browser_use", object())
    monkeypatch.setattr(cli, "recorder_up", lambda: True)
    calls = []

    async def fake_run(run_id, provider, model, max_steps, spend):
        calls.append((run_id, provider, model))

    monkeypatch.setattr(cli, "_browser_use_run", fake_run)
    argv = ["browser-use", "--provider", "openrouter", "--prefix", "bu", "--out", str(tmp_path)]
    assert main(argv) == 0
    assert calls == [("bu-01", "openrouter", "anthropic/claude-sonnet-5")]
    label = json.loads((tmp_path / "bu-01.jsonl").read_text())
    assert label["generator"] == "browser-use" and label["agentClass"] == "A"
    assert label["config"] == "stock, highlights on, anthropic/claude-sonnet-5 via openrouter"


def test_browser_use_start_resumes_a_series(monkeypatch, tmp_path):
    from agentlens_runners import cli

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only")
    monkeypatch.setitem(sys.modules, "browser_use", object())
    monkeypatch.setattr(cli, "recorder_up", lambda: True)
    calls = []

    async def fake_run(run_id, provider, model, max_steps, spend):
        calls.append((run_id, provider, model))

    monkeypatch.setattr(cli, "_browser_use_run", fake_run)
    argv = ["browser-use", "--runs", "2", "--start", "14", "--prefix", "bu", "--out", str(tmp_path)]
    assert main(argv) == 0
    assert calls == [
        ("bu-14", "anthropic", "claude-opus-5-5"),
        ("bu-15", "anthropic", "claude-opus-5-5"),
    ]


def test_drop_null_cache_control_keeps_real_cache_markers():
    body = {
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": "a", "cache_control": None}]},
            {"role": "user", "content": [{"type": "text", "cache_control": {"type": "ephemeral"}}]},
        ],
        "system": [{"type": "text", "text": "s", "cache_control": None}],
    }
    out = drop_null_cache_control(body)
    assert out["messages"][0]["content"][0] == {"type": "text", "text": "a"}
    assert out["messages"][1]["content"][0]["cache_control"] == {"type": "ephemeral"}
    assert out["system"] == [{"type": "text", "text": "s"}]


def test_response_cost_reads_openrouter_usage():
    assert response_cost(b'{"usage": {"input_tokens": 3, "cost": 0.0125}}') == 0.0125
    assert response_cost(b'{"usage": {"input_tokens": 3}}') == 0.0
    assert response_cost(b"not json") == 0.0


def test_browser_use_budget_stops_between_runs(monkeypatch, tmp_path, capsys):
    from agentlens_runners import cli

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only")
    monkeypatch.setitem(sys.modules, "browser_use", object())
    monkeypatch.setattr(cli, "recorder_up", lambda: True)
    calls = []

    async def fake_run(run_id, provider, model, max_steps, spend):
        calls.append(run_id)
        spend["usd"] += 0.6

    monkeypatch.setattr(cli, "_browser_use_run", fake_run)
    argv = ["browser-use", "--provider", "openrouter", "--runs", "5", "--budget", "1"]
    assert main([*argv, "--prefix", "bu", "--out", str(tmp_path)]) == 3
    assert calls == ["bu-01", "bu-02"]
    out = capsys.readouterr().out
    assert "bu-02: OpenRouter cost $0.6000, $1.2000 so far" in out
    assert "stopping before 3" in out
