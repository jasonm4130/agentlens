import json

import pytest
from conftest import agent_label, human_label, verdict

from agentlens_eval.gate import (
    FAIL,
    INCOMPLETE,
    NOT_EVALUATED,
    NOT_RUN,
    PASS,
    CommandResult,
    evaluate,
    passed,
    size_summary,
)
from agentlens_eval.golden import write_golden
from agentlens_eval.load import label_errors, load
from agentlens_eval.metrics import human_rows, minimal_baseline, recall_rows
from agentlens_eval.stats import Rate, rule_of_three, wilson
from baselines.minimal_tree import fit, flags_at_equal_human_flags, grouped_scores, predict


def test_wilson_matches_known_values():
    lo, hi = wilson(12, 15)
    assert lo == pytest.approx(0.5481, abs=1e-3)
    assert hi == pytest.approx(0.9295, abs=1e-3)
    assert wilson(0, 0) == (0.0, 1.0)
    assert wilson(0, 40)[0] == 0.0


def test_rule_of_three_only_at_the_edges():
    assert rule_of_three(0, 40) == "<= 7.5%"
    assert rule_of_three(15, 15) == ">= 80.0%"
    assert rule_of_three(3, 15) is None
    assert "rule of three <= 7.5%" in str(Rate(0, 40))
    assert str(Rate(0, 0)) == "n/a (0/0)"


def test_label_validation():
    assert label_errors(agent_label("r", "patchright", "A")) == []
    assert label_errors(human_label("h", "mouse")) == []
    assert "generator patchright is class A" in label_errors(agent_label("r", "patchright", "B"))
    bad = human_label("h", "mouse", participant="Ada")
    assert any("pseudonym" in e for e in label_errors(bad))
    assert any("cohort" in e for e in label_errors(human_label("h", "telepathy")))


def test_unlabelled_runs_are_left_out_and_last_seq_wins(tmp_path, write_run):
    write_run("nolabel", None, verdict("agent-likely", 1))
    write_run(
        "r1",
        agent_label("r1", "patchright", "A"),
        verdict("agent-unattributed", 3, rules=("R1", "R7")),
        verdict("human-like", 1),
    )
    loaded = load([tmp_path])
    assert loaded.runs["run"].to_list() == ["r1"]
    row = loaded.runs.row(0, named=True)
    assert row["label"] == "agent-unattributed"
    assert row["flagged"] is True
    assert row["tier1"] is False
    assert any("nolabel" in p for p in loaded.problems)


def test_a_run_without_a_verdict_counts_as_missed(tmp_path, write_run):
    write_run("r1", agent_label("r1", "playwright-headless", "A"))
    loaded = load([tmp_path])
    assert loaded.runs.row(0, named=True)["flagged"] is False
    assert any("no verdict" in p for p in loaded.problems)


def test_baselines_flag_a_run_when_any_page_flags(tmp_path, write_run):
    base = [
        {"kind": "baseline", "url": "/", "payload": {"name": "botd", "bot": False}},
        {"kind": "baseline", "url": "/p2", "payload": {"name": "botd", "bot": True}},
        {"kind": "baseline", "url": "/", "payload": {"name": "agent-detector", "class": "bot"}},
        {"kind": "baseline", "url": "/", "payload": {"name": "agent-detector", "class": "human"}},
    ]
    write_run("r1", agent_label("r1", "patchright", "A"), verdict("human-like", 1), extra=base)
    row = load([tmp_path]).runs.row(0, named=True)
    assert row["botd_flag"] is True
    # The last result per page counts: this page ended human.
    assert row["ad_flag"] is False


def test_tree_separates_and_scores_only_held_out_groups():
    xs = [(1.0, 1.0), (1.2, 0.9), (30.0, 0.1), (25.0, 0.0)]
    ys = [1, 1, 0, 0]
    tree = fit(xs, ys)
    assert predict(tree, (1.1, 1.0)) == 1.0
    assert predict(tree, (28.0, 0.0)) == 0.0
    # One group per class: holding a group out leaves one class, so nothing is scored.
    assert grouped_scores(xs, ys, ["a", "a", "h", "h"]) == [None] * 4
    scores = grouped_scores(xs, ys, ["a1", "a2", "h1", "h2"])
    assert scores == [1.0, 1.0, 0.0, 0.0]


def test_equal_human_flags_picks_the_most_permissive_threshold():
    scores = [0.9, 0.6, 0.6, 0.2, None]
    ys = [1, 1, 0, 0, 1]
    flags, t = flags_at_equal_human_flags(scores, ys, max_human_flags=0)
    assert t == 0.9 and flags == [True, False, False, False, False]
    flags, t = flags_at_equal_human_flags(scores, ys, max_human_flags=1)
    assert t == 0.6 and flags == [True, True, True, False, False]


def _gate(tmp_path, commands=None):
    loaded = load([tmp_path])
    return {c.id: c for c in evaluate(loaded, minimal_baseline(loaded), commands)}


def test_gate_never_passes_without_humans(tmp_path, write_run):
    for i in range(15):
        run = f"hl-{i}"
        write_run(
            run,
            agent_label(run, "playwright-headless", "A"),
            verdict("agent-likely", 1, confidence="certain", rules=("webdriver",), agent_class="A"),
        )
    checks = _gate(tmp_path)
    assert checks["1"].status == NOT_EVALUATED
    assert checks["2"].status == NOT_EVALUATED
    assert checks["3"].status == INCOMPLETE
    assert checks["4"].status == NOT_EVALUATED
    assert checks["6.size"].status == NOT_RUN
    assert not passed(list(checks.values()))


def test_gate_fails_on_any_human_flag_and_reports_tier1_hits(tmp_path, write_run):
    write_run("h1", human_label("h1", "mouse"), verdict("human-like", 1))
    write_run(
        "h2",
        human_label("h2", "keyboard-only", "P02"),
        verdict("agent-likely", 1, confidence="certain", rules=("webdriver",)),
    )
    checks = _gate(tmp_path)
    assert checks["1"].status == FAIL
    assert checks["2"].status == FAIL
    rows = human_rows(load([tmp_path]).runs)
    assert rows[-1][0] == "**all**" and rows[-1][4] == 1


def test_recall_gate_fails_below_threshold(tmp_path, write_run):
    for i in range(15):
        run = f"hf-{i}"
        label = "agent-likely" if i < 11 else "human-like"
        write_run(run, agent_label(run, "playwright-headful", "A"), verdict(label, 1))
    checks = _gate(tmp_path)
    assert checks["3"].status == FAIL
    assert "11/15" in "\n".join(checks["3"].detail)
    assert recall_rows(load([tmp_path]).runs)[0][1] == "playwright-headful"


def test_minimal_baseline_at_equal_human_flags(tmp_path, write_run):
    # Agents: low event rate, all single-move clicks. Humans: high rate, no single-move clicks.
    for i in range(4):
        run = f"a{i}"
        lab = agent_label(run, "patchright" if i % 2 else "playwright-headless", "A")
        write_run(
            run,
            lab,
            verdict(
                "agent-unattributed",
                1,
                mouseEvents=10,
                mouseActiveSecs=5,
                clicks=5,
                singleMoveClicks=5,
            ),
        )
    for i in range(4):
        run = f"h{i}"
        write_run(
            run,
            human_label(run, "mouse", f"P0{i}"),
            verdict("human-like", 1, mouseEvents=600, mouseActiveSecs=20, clicks=5),
        )
    loaded = load([tmp_path])
    res = minimal_baseline(loaded)
    assert res.trainable and res.max_human_flags == 0 and res.human_flags == 0
    assert res.by_class["A"] == (4, 4, 4)
    check = _gate(tmp_path)["4"]
    # Class A passes (equal recall); class C has no runs, so the check is not complete.
    assert check.status == INCOMPLETE


def test_command_results_and_size_summary(tmp_path, write_run):
    out = json.dumps([{"name": "agentlens.mjs (ESM)", "passed": True, "size": 9954}])
    checks = _gate(
        tmp_path, {"size": CommandResult(True, out), "ssr": CommandResult(False, "boom")}
    )
    assert checks["6.size"].status == PASS
    assert checks["6.ssr"].status == FAIL
    assert size_summary(out) == ["- agentlens.mjs (ESM): 9954 B gzip, within its cap"]


def test_golden_fixtures_keep_existing_files(tmp_path, write_run):
    runs = tmp_path / "runs"
    runs.mkdir()
    (runs / "r1.jsonl").write_text(
        json.dumps(agent_label("r1", "patchright", "A"))
        + "\n"
        + json.dumps(
            {"kind": "verdict", "payload": verdict("agent-unattributed", 1, rules=("R1",))}
        )
        + "\n"
    )
    out = tmp_path / "golden"
    loaded = load([runs])
    assert len(write_golden(loaded, out)) == 1
    fixture = json.loads((out / "r1.json").read_text())
    assert fixture["expected"] == {"label": "agent-unattributed", "confidence": "medium"}
    assert fixture["truth"]["generator"] == "patchright"
    assert write_golden(loaded, out) == []
