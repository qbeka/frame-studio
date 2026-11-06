#!/usr/bin/env bash
# Proves the repository works from a fresh clone, using only what is committed.
#   scripts/verify-clean.sh [--bench]
# It stops at the first failure. Pass --bench to include the benchmark smoke run.
set -euo pipefail

repo=$(git rev-parse --show-toplevel)
dir=$(mktemp -d "${TMPDIR:-/tmp}/frame-clean-XXXXXX")
trap 'rm -rf "$dir"' EXIT

git clone --quiet "$repo" "$dir/frame-studio"
cd "$dir/frame-studio"
echo "Clean clone at $(git rev-parse --short HEAD)"

pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm test:e2e
if [[ "${1:-}" == "--bench" ]]; then pnpm bench:smoke; fi
git status --porcelain -- ':!evidence' | { ! grep . ; }
echo "Clean checkout verification passed."
