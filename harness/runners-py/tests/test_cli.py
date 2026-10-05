import json
import sys

import pytest

from agentlens_runners.cli import browser_use_url, docker_command, main, task_prompt
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
