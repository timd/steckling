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

TICKETBRANCH="eng-123-e2e-check"
export E2E_HOOKS_LOG="$(mktemp)"

cleanup() {
  ( cd "$DEMO" && "$BUN" run "$CLI" rm "$BRANCH" --yes --force >/dev/null 2>&1 || true )
  ( cd "$DEMO" && "$BUN" run "$CLI" rm "$TICKETBRANCH" --yes --force >/dev/null 2>&1 || true )
  git -C "$ROOT" worktree list --porcelain | grep -o "/.*$TICKETBRANCH" | head -1 | \
    xargs -r -I{} git -C "$ROOT" worktree remove --force {} >/dev/null 2>&1 || true
  git -C "$ROOT" branch -D "$TICKETBRANCH" >/dev/null 2>&1 || true
  docker ps -aq --filter "name=steckling_" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker volume ls -q --filter "name=steckling_" | xargs -r docker volume rm >/dev/null 2>&1 || true
  docker network ls -q --filter "name=steckling_" | xargs -r docker network rm >/dev/null 2>&1 || true
  rm -rf "$DEMO/.steckling" "$E2E_HOOKS_LOG"
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

echo "==> ticket + hooks (steck new/rm $TICKETBRANCH)"
( cd "$DEMO" && "$BUN" run "$CLI" new "$TICKETBRANCH" "$BRANCH" )
grep -q "postCreate eng-123" "$E2E_HOOKS_LOG" || { echo "✗ postCreate hook didn't run with the ticket"; exit 1; }
listout="$( cd "$DEMO" && "$BUN" run "$CLI" list )"
echo "$listout" | grep -q "eng-123" || { echo "✗ ticket missing from steck list"; exit 1; }
( cd "$DEMO" && "$BUN" run "$CLI" rm "$TICKETBRANCH" --yes )
grep -q "teardown eng-123" "$E2E_HOOKS_LOG" || { echo "✗ teardown hook didn't run on rm"; exit 1; }

echo "==> MCP smoke"
( cd "$ENG" && "$BUN" run test/mcp-smoke.ts )

echo "E2E PASSED"
