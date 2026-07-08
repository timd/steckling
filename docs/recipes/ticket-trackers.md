# Recipe: Ticket trackers (Linear, Jira, GitHub Issues, …)

Steckling keys everything off the branch name — and most trackers generate (or accept) branch
names that contain the issue key. Give Steckling the pattern once and **branch = ticket = stack**:
every worktree knows which ticket it serves, shows it in `steck list`, injects it into hooks and
your app as `$STECKLING_TICKET`, and exposes it to agents over MCP.

Steckling never calls a tracker's API. The engine carries *identity*; transitions live in your
hook strings (this page) or in an orchestrating agent (bottom of this page) — wherever judgment
lives in your setup.

## The convention

Use your tracker's branch-name format, and add a `ticket` block to `steckling.yml`. Patterns are
matched **case-insensitively** against the branch name; the first match is the ticket ID, stored
verbatim.

**Linear** — "Copy git branch name" produces `tim/eng-123-fix-login`:

```yaml
ticket:
  pattern: "eng-\\d+" # your team key
  url: "https://linear.app/acme/issue/{ticket}"
```

**Jira** — branch names like `feature/PROJ-42-fix-login`:

```yaml
ticket:
  pattern: "[a-z][a-z0-9]*-\\d+"
  url: "https://acme.atlassian.net/browse/{ticket}"
```

**GitHub Issues** — branch names like `gh-321-fix-login` (or GitHub's own
`321-fix-login` from "Create a branch" on an issue):

```yaml
ticket:
  pattern: "\\d+" # or "gh-\\d+" if you prefix
  url: "https://github.com/acme/app/issues/{ticket}"
```

No `ticket` block → no parsing, no env var, no list column. When a branch name doesn't contain
the ID (or the parse would be wrong), set it explicitly: `steck new my-branch --ticket ENG-456`.

## The manual flow

```sh
# copy the branch name from your tracker, then:
steck new tim/eng-123-fix-login --up     # worktree + isolated stack + ticket recorded
steck list                               # BRANCH  STATUS  TICKET   PORTS  PATH
# … work; $STECKLING_TICKET is in the env of app.run, hooks, and `steck exec` …
steck rm tim/eng-123-fix-login           # teardown hook runs, then the stack is destroyed
```

## Wiring transitions into hooks

The identity vars (`STECKLING_TICKET`, `STECKLING_TICKET_URL`, `STECKLING_BRANCH`) are injected
into every hook, so ticket transitions are one-liners with your tracker's CLI or `curl`. Tokens
come from your shell env — Steckling never stores them.

```yaml
hooks:
  provision: "npm run migrate && npm run seed && linear issue update $STECKLING_TICKET --state 'In Progress'"
  postCreate: 'gh issue comment "$STECKLING_TICKET" --body "stack created on $STECKLING_BRANCH"'
  teardown: 'curl -s -H "Authorization: $LINEAR_API_KEY" ... # comment / transition on cleanup'
```

Which hook for "work started" is your choice:

- `postCreate` fires when `steck new` creates the worktree (before any services exist — identity
  env only). A failure warns but keeps the worktree.
- `provision` fires exactly once on the first `steck up`, with the full service env — the natural
  home for "mark In Progress when the stack first boots".
- `teardown` fires before `steck rm` / `steck prune` destroy the stack. A failure aborts `rm`
  (escape hatch: `--force`) and skips that branch in `prune`.

## The agent flow

An orchestrating agent with your tracker's MCP server + `steck mcp` closes the loop without any
engine-side integration: read the ticket → `steckling_new` the branch (ticket parsed
automatically) → work in the worktree → comment/transition via the tracker MCP → `steck rm` on
merge. The `steckling://registry` resource carries each worktree's `ticket`, so the agent always
knows which stack serves which issue. One ticket, one branch, one isolated stack, one agent.

## What Steckling deliberately doesn't do

No tracker API calls, no auth, no state sync, no webhooks. The ticket field is identity, not
integration — that keeps the engine vendor-blind and the moving parts in your hooks and agents,
where you can see them.
