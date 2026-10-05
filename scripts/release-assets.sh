#!/usr/bin/env bash
# Stages the files a GitHub Release attaches (architecture 3 and 9 M2) and writes its notes.
# Usage: scripts/release-assets.sh <tag> <out-dir> <notes-file>
# Fails unless <tag> is v<version> of packages/core and every built file is present, so a
# release can never ship a stale or partial build. Run after `pnpm build`.
set -euo pipefail

tag=${1:?tag, e.g. v0.1.0}
out=${2:?output directory}
notes=${3:?notes file}
core=packages/core
version=$(node -p "require('./$core/package.json').version")

if [[ "$tag" != "v$version" ]]; then
  echo "tag $tag does not match $core version $version (expected v$version)" >&2
  exit 1
fi

files=(agentlens.mjs agentlens.iife.js scorer.mjs agentlens.d.ts scorer.d.ts)
rm -rf "$out"
mkdir -p "$out"
for f in "${files[@]}"; do
  if [[ ! -s "$core/dist/$f" ]]; then
    echo "missing $core/dist/$f; run pnpm build first" >&2
    exit 1
  fi
  cp "$core/dist/$f" "$out/$f"
done
(cd "$out" && sha256sum "${files[@]}" > SHA256SUMS)

{
  echo "Built from $tag ($(git rev-parse --short HEAD)). Vendor the files below; there is no npm package."
  echo
  # The changeset entry for this version, when changeset version wrote one.
  if [[ -f "$core/CHANGELOG.md" ]]; then
    awk -v v="## $version" '$0 == v {on = 1; next} on && /^## / {exit} on' "$core/CHANGELOG.md"
    echo
  fi
  echo "**Release gate (architecture 7.6):** state the result of \`uv run eval.py gate\` here before"
  echo "publishing. If the gate has not passed, Tier 2 labels ship as evidence only and these notes"
  echo "must say so."
  echo
  echo "A verdict computed in the visitor's browser is readable and forgeable: use it to understand"
  echo "your traffic in aggregate, never to block or gate access."
} > "$notes"

echo "staged ${#files[@]} files and SHA256SUMS in $out; notes in $notes"
