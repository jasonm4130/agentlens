"""Baselines run on the same harness runs as agentlens (architecture 7.4).

- `minimal_tree`: the arXiv 2607.26935 minimal model, trained here on grouped splits.
- BotD (@fingerprintjs/botd) and agent-detector (@doubleagent-so/agent-detector) run in the
  fixture page itself when it is loaded with `?baselines=1` (apps/fixture/boot.js); their
  per-page results arrive as `baseline` lines in the same JSONL and are read by `load.py`.
"""
