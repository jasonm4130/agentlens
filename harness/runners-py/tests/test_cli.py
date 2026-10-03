import pytest

from agentlens_runners.cli import docker_command, main, task_prompt


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
