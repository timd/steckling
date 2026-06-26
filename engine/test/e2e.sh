#!/usr/bin/env bash
#
# End-to-end test of the Steckling loop against real Docker, on the demo project.
# Runs `up → exec → list`, then the MCP smoke test. Cleans up after itself.
#
# Requires: bun (on PATH or via $BUN), docker, and a NAMED git branch (not
# detached HEAD — CI must `git checkout -B <name>` first).
#
#   BUN=~/.bun/bin/bun bash engine/test/e2e.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"   # engine/test
ENG="$(dirname "$HERE")"                # engine
ROOT="$(dirname "$ENG")"                # repo root
DEMO="$ROOT/demo"
CLI="$ENG/src/cli.ts"
BUN="${BUN:-bun}"

BRANCH="$(git -C "$DEMO" rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" = "HEAD" ]; then
  echo "✗ Detached HEAD — checkout a named branch first (git checkout -B steckling-ci)." >&2
  exit 1
fi
echo "branch under test: $BRANCH"

cleanup() {
  ( cd "$DEMO" && "$BUN" run "$CLI" rm "$BRANCH" --yes --force >/dev/null 2>&1 || true )
  docker ps -aq --filter "name=steckling_" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker volume ls -q --filter "name=steckling_" | xargs -r docker volume rm >/dev/null 2>&1 || true
  docker network ls -q --filter "name=steckling_" | xargs -r docker network rm >/dev/null 2>&1 || true
  rm -rf "$DEMO/.steckling"
}
trap cleanup EXIT

echo "==> steck up --no-run"
( cd "$DEMO" && "$BUN" run "$CLI" up --no-run )

echo "==> steck exec -- check (expect: alpha, beta, gamma)"
out="$( cd "$DEMO" && "$BUN" run "$CLI" exec -- bun run app/check.ts )"
echo "$out"
echo "$out" | grep -q "alpha, beta, gamma" || { echo "✗ seed data missing"; exit 1; }

echo "==> steck list"
( cd "$DEMO" && "$BUN" run "$CLI" list )

echo "==> MCP smoke"
( cd "$ENG" && "$BUN" run test/mcp-smoke.ts )

echo "E2E PASSED"
