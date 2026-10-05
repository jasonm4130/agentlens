"""The committed evidence agrees with itself: every committed labelled run has a golden fixture
with the same final features, and every golden fixture comes from a committed run."""

import json
from pathlib import Path

from agentlens_eval.load import load

ROOT = Path(__file__).resolve().parents[2]
RUNS = sorted(p for p in (ROOT / "eval" / "runs").iterdir() if p.is_dir())
GOLDEN = {p.stem: json.loads(p.read_text()) for p in (ROOT / "fixtures" / "golden").glob("*.json")}


def test_committed_runs_and_golden_fixtures_match():
    loaded = load(RUNS)
    assert not loaded.problems
    runs = set(loaded.runs["run"].to_list())
    assert runs == set(GOLDEN)
    for run in runs:
        g = GOLDEN[run]
        assert g["features"] == loaded.features[run]
        v = loaded.final[run]
        assert g["expected"]["label"] == v["label"] or g["changes"], run
