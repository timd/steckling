# Steckling — Ticket-Aware Branches (Plan)

Implementation plan for making Steckling *workflow-opinionated* (branch = ticket = stack)
while staying strictly *vendor-blind*: no ticketing API, no auth, no Linear-specific code in
the engine. Three layers, independently adoptable:

1. **Convention (docs only)** — a recipe for driving Steckling from tracker-generated branch
   names (Linear, Jira, GitHub Issues as equal peers), composing a tracker MCP with the steck MCP.
2. **Ticket metadata seam** — a generic `ticket` config block + registry field, parsed from the
   branch name (or set explicitly), surfaced in `list`/`status`/env/MCP.
3. **Lifecycle hooks** — wire the already-documented-but-never-executed `hooks.teardown` (in
   both `rm` and `prune`), add `hooks.postCreate`, and inject ticket identity into every hook so
   ticket transitions live in user hook strings (exactly where language-specific logic already
   lives).

Build order is **2 → 3 → 1**: the recipe lands last so it documents shipped features.

> Decisions T1–T12 below were stress-tested in a grill session (2026-07-08); notable outcomes:
> ticket transitions belong in hooks (not agent-layer-only), teardown also runs on `prune`
> (skip-on-fail), tickets backfill on `up`, parsing is strictly opt-in (no default pattern),
> and docs/blurb are **generic-first** — no vendor named in the README, trackers are peers.

---

## 0. Design decisions (locked for this plan)

| # | Question | Decision | Why |
| - | --- | --- | --- |
| T1 | Vendor naming | Config block is `ticket:`, never `linear:` | Engine stays vendor-blind; Linear specifics live only in the recipe and in user hook strings / URL templates. |
| T2 | How ticket is derived | Regex against the branch name (`ticket.pattern`), overridable with `steck new --ticket <id>` | Branch names are the identity Steckling already keys on; Linear's generated names (`tim/eng-123-fix-login`) make the parse free. |
| T3 | Where it's stored | `WorktreeRecord.ticket?: string` in the registry, set at record-creation time (`newWorktree` and first `up`); **backfilled on any `up`** when the record has no ticket and the parse succeeds (explicit `--ticket` values are never overwritten) | Records are the single source of truth; `list`/`status`/MCP all read them. Backfill lets pre-feature registries heal themselves on next use. Correction path for a wrong explicit value: `rm` + `new`, or hand-edit the registry (rare; documented). |
| T4 | Case handling | Patterns are compiled **case-insensitively** (JS regexes have no inline `(?i)`; the schema rejects such patterns); the match is stored verbatim | Ticket IDs are case-insensitive in every tracker; no transform magic in v1. *(Amended during implementation — the original `(?i)`-in-recipes idea doesn't work in a JS engine.)* |
| T5 | New hooks | Wire existing `teardown` (pre-`rm` **and per-branch in `prune`**), add `postCreate` (post-`steck new`) — nothing else | Smallest set that covers ticket start/finish transitions. No `firstUp` hook: `provision` already runs exactly once on first boot (with full service env), so transition-at-first-boot goes there; the recipe documents the choice. No `onUp`/`onDown` until someone needs them. |
| T6 | Hook failure semantics | `postCreate` non-zero → warn, keep the worktree. `teardown` non-zero in `rm` → abort unless `--force`. `teardown` non-zero in `prune` → **skip that branch** (left un-pruned, warned) and continue the batch | A failed ticket comment shouldn't destroy a fresh worktree; `teardown` may guard real cleanup (data export), so it must be able to stop a destructive `rm`; but one broken hook (e.g. expired tracker token) must not wedge bulk GC. |
| T7 | Env injection | Always inject `STECKLING_BRANCH`, `STECKLING_PROJECT`; when a ticket is known also `STECKLING_TICKET` (name overridable via `ticket.env`) and `STECKLING_TICKET_URL` (rendered from `ticket.url`). On a key collision, **`env.extra` wins** and the engine warns | Hooks, `app.run`, `exec`, and `.steckling/env` all get ticket identity for free. User-explicit config beats engine-injected values — the config is the contract — and the warning keeps the override from being silent. |
| T8 | No API calls, ever | The engine never talks to a ticketing service | The orchestration layer (agents composing a tracker MCP + steck MCP) owns judgment about ticket state; the engine only carries identity. Consistent with the fleet-orchestration deferral in `plan.md` §12. |
| T9 | Opt-in vs default-on | Strictly opt-in: no `ticket:` block → no parsing, no `STECKLING_TICKET`, no `list` column. No built-in default pattern | Zero surprise for existing users; branch names like `fix-2-flaky-tests` can't produce garbage tickets. The recipe makes opting in a 2-line copy-paste. |
| T10 | Transitions ownership | Hook strings carry ticket transitions (CLI/curl against the tracker); agents can layer richer behavior on top | Works without an agent in the loop — a human using bare `steck` still gets ticket automation. Engine-native transitions stay rejected (vendor-blindness, auth). |
| T11 | Docs positioning | **Generic-first**: the recipe is `docs/recipes/ticket-trackers.md` with Linear, Jira, and GitHub Issues as equal peers; the README blurb names no vendor | Purest match for the engine's vendor-blindness. Accepted trade-off: slightly weaker search discoverability than a Linear-titled recipe. |
| T12 | Ticket correction surface | No `--ticket` on `up`, no `steck ticket set` command in v1 | Backfill (T3) covers the common case; a wrong explicit ticket is rare enough for rm+new. Keep `up`'s surface flat. |

---

## 1. Config surface (additive, `.strict()` like `agent`/`deploy`)

```yaml
# steckling.yml — everything below is optional; absent blocks behave exactly as today
ticket:
  pattern: "eng-\\d+"                              # first match against the branch name (case-insensitive)
  url: "https://tracker.example.com/issue/{ticket}" # optional; {ticket} placeholder required if set
  env: "STECKLING_TICKET"                          # optional; default STECKLING_TICKET

hooks:
  provision: "npm run migrate && npm run seed"       # unchanged; also the natural home for a
                                                     # "mark ticket In Progress" transition (runs
                                                     # exactly once, on first boot, with full env)
  postCreate: "tracker-cli start $STECKLING_TICKET"  # NEW — after `steck new`
  teardown: "tracker-cli comment $STECKLING_TICKET 'stack removed'"  # NOW EXECUTED — before `rm`/`prune` destroy
```

Validation (zod `superRefine`, mirroring the `agent`/`deploy` checks):
- `ticket.pattern` must compile as a RegExp (catch at parse time, not first use).
- `ticket.url`, if set, must contain `{ticket}` (same style as the `expose` `{port}` check).

---

## 2. Engine changes, module by module

### `engine/src/ticket.ts` (new, ~40 lines)
- `parseTicket(cfg, branch): string | null` — first match of `ticket.pattern` against the branch
  name; null when no block or no match.
- `ticketUrl(cfg, ticket): string | null` — render `ticket.url` with `{ticket}`.
- Pure functions, no I/O — unit-testable without Docker.

### `engine/src/config.ts`
- Add the `ticket` block and `hooks.postCreate` to `StecklingConfigSchema` (T1, T5).
- Add the two `superRefine` checks above.
- Update `config-reference` docs table (see §4).

### `engine/src/registry.ts`
- `WorktreeRecord` gains `ticket?: string` (optional → old registries load unchanged, same
  pattern as `railway?`).

### `engine/src/env.ts`
- `resolveEnv` gains branch/ticket context (either extra params or a small `meta` argument —
  pick whichever keeps call sites cleanest) and emits `STECKLING_BRANCH`,
  `STECKLING_PROJECT`, and when known `STECKLING_TICKET` (name from `ticket.env`) +
  `STECKLING_TICKET_URL` (T7). These land in `.steckling/env`, so the app, `exec`, and all
  hooks inherit them with zero further plumbing.

### `engine/src/lifecycle.ts`
- **Record creation** (`newWorktree` ~`lifecycle.ts:285`, and the first-`up` record-write path):
  set `ticket: explicit ?? parseTicket(cfg, branch)` (T3). `newWorktree` accepts the parsed
  `--ticket` value via its options.
- **Backfill** (`up`, T3): when the existing record has no `ticket` and `parseTicket` matches,
  write it into the record during the registry update `up` already performs (`lastUsedAt`).
- **`postCreate` hook** (`newWorktree`, after `createWorktree` + registry write, before the
  optional `--up`): run via `runHook` in the new worktree dir with the T7 env. Note in docs:
  services don't exist yet, so no `DATABASE_URL` etc. at this point — this hook is for
  ticket/notification side effects, not provisioning. Non-zero → `log.warn`, continue (T6).
- **`teardown` hook** (`rm` ~`lifecycle.ts:454`, after the confirm, before `destroyProject`):
  run in `record.path` with env from `readDotenv(record.path)` merged with the T7 vars.
  Skip with a warn if the worktree dir no longer exists. Non-zero → abort `rm` unless
  `--force` (T6). This closes the gap where `hooks.teardown` is schema-valid but never runs.
- **`teardown` in `prune`** (~`lifecycle.ts:512`): run per branch before that branch's stack is
  destroyed, same env resolution as `rm`. Non-zero → skip that branch (leave it un-pruned,
  `log.warn`) and continue the batch (T6); report skipped branches in the summary line.
- **`list`** — add a `ticket` column (blank when unset). **`status`** — show ticket and, when
  `ticket.url` is set, the rendered link. **`snapshot()`** — include `ticket` so the MCP
  registry resource carries it.

### `engine/src/cli.ts`
- `steck new <branch> [base] --ticket <id>` — parse the flag value (note: current flag parsing
  is boolean-only `startsWith("-")` filtering; `--ticket` needs a value-taking parse, keep it
  local and simple).
- Update `HELP` text for `new`, and document that `rm --force` also skips a failing teardown.
- Delete the stale "stubbed until later milestones" comment at the top of the file while there
  (CLAUDE.md already flags it as stale).

### `engine/src/mcp/server.ts`
- `steckling://registry` picks up `ticket` for free via the record. Mention ticket in the
  resource/tool descriptions so orchestrating agents know it's there. No new tools.

---

## 3. Tests

- **Unit** (`engine/test/ticket.test.ts`, bun test, same style as `railway.test.ts`):
  pattern match/miss, case-insensitive matching, `{ticket}` URL rendering, invalid-regex config rejection,
  `--ticket` override beating the parse, backfill only-when-unset (an existing ticket value is
  never overwritten), env.extra-wins precedence.
- **Config**: schema accepts/rejects fixtures for the new blocks (extend whatever config tests
  exist; add them if none).
- **e2e** (`test/e2e.sh`): extend with a branch named `eng-123-e2e-check`, a `ticket.pattern`,
  and `postCreate`/`teardown` hooks that append to a temp file — assert the file contents, that
  `steck list` shows the ticket, and that `rm` runs teardown. If feasible without bloating the
  script, also cover prune's skip-on-fail with a deliberately failing teardown. Keeps the
  "verify against Docker, not just the type-checker" rule.
- `bun run typecheck` stays clean (hard requirement).

---

## 4. Documentation deliverables

| File | Change |
| --- | --- |
| `docs/recipes/ticket-trackers.md` (new) | The convention recipe (§5) — Linear, Jira, GitHub Issues as equal peers. |
| `docs/config-reference.md` | `ticket` block reference; `hooks.postCreate` row; change `hooks.teardown` from "Reserved." to its real semantics (`rm` + `prune`); document the injected `STECKLING_*` vars and the env.extra-wins precedence next to `env.extra`. |
| `docs/commands.md` | `new --ticket`; `rm` teardown-hook step + `--force` semantics; `prune` per-branch teardown + skip-on-fail; `list`/`status` ticket column. |
| `docs/concepts.md` | Short "Ticket-aware branches" paragraph after the three-things section (blurb B2 below). |
| `docs/mcp.md` | Note `ticket` in the registry resource payload + one line on orchestrator usage. |
| `docs/recipes/README.md` | Add ticket-trackers.md to the index. |
| `README.md` (repo root) | Blurb B1 below, plus a 5-line config snippet. |
| `CLAUDE.md` | Add `ticket.ts` to the module map; remove the now-fixed "stale comment" note about `cli.ts`. |
| `docs/plan.md` §12 | One-line note that ticket metadata + hooks landed as the substrate for fleet orchestration (which stays deferred). |

### §5. The ticket-trackers recipe (`docs/recipes/ticket-trackers.md`) — outline

Generic-first (T11): the recipe is about the *convention*, with per-tracker snippets as peers.

1. **The convention**: most trackers generate (or accept) branch names containing the issue key
   (`tim/eng-123-fix-login`); branch = ticket = stack. One copy-paste `ticket:` block per
   tracker: Linear (`eng-\d+`, linear.app URL), Jira (`[a-z][a-z0-9]*-\d+`, atlassian URL),
   GitHub Issues (`\d+` after a `gh-`/`issues/` prefix, repo issues URL). Patterns match
   case-insensitively (T4).
2. **Manual flow**: copy the branch name from the tracker → `steck new <branch> --up` → work →
   `steck rm`. Show `list` output with the ticket column.
3. **Hook wiring** (T10): `postCreate`/`teardown` examples using each tracker's CLI or `curl`
   with `$STECKLING_TICKET` (tokens via the user's shell env — explicitly *not* stored by
   Steckling). Note the `provision` option for transition-at-first-boot (T5).
4. **Agent flow**: an orchestrating agent with a tracker MCP + `steck mcp` — read ticket, create
   branch+stack, work, comment, remove. Position as the precursor to fleet orchestration
   (`plan.md` §12).
5. **What Steckling deliberately doesn't do**: no API calls, no auth, no state sync — the
   ticket field is identity, not integration.

---

## 6. Blurb copy (drafts)

Vendor-neutral per T11 — no tracker named in the README; the recipe holds the per-tracker
specifics.

**B1 — README, after the three-things list:**

> **Plays well with your ticket tracker.** Steckling can parse a ticket ID out of your branch
> name (`tim/eng-123-fix-login` → `ENG-123`), remember it, show it in `steck list`, inject it
> into every hook as `$STECKLING_TICKET`, and expose it over MCP — so "one ticket, one branch,
> one isolated stack, one agent" is a config block, not a platform. If your tracker generates
> branch names, it already works ([recipe](docs/recipes/ticket-trackers.md)); nothing in the
> engine knows which tracker you use.

**B2 — concepts.md paragraph:**

> ### Ticket-aware branches (optional)
> Steckling keys everything off the branch name — and if your tracker generates branch names
> (most can), the branch name already contains the ticket. Give Steckling the pattern once
> (`ticket.pattern`) and every worktree knows which ticket it serves: visible in
> `list`/`status`, injected into hooks and your app as `$STECKLING_TICKET`, readable by agents
> over MCP. Steckling never calls the tracker's API; transitions belong in your hook strings or
> your agent, where judgment lives.

---

## 7. Milestones

| M | Scope | Done when |
| - | --- | --- |
| T-M1 | Ticket seam: `ticket.ts`, config block, registry field + backfill-on-up, `--ticket`, env injection (extra-wins precedence), `list`/`status`/`snapshot` | Unit tests green; `steck list` shows a parsed ticket for a real branch; typecheck clean |
| T-M2 | Hooks: `postCreate` wired in `newWorktree`, `teardown` wired in `rm` (+ `--force`) and `prune` (skip-on-fail) | e2e hook-marker assertions pass against real Docker |
| T-M3 | Docs + blurb: all §4 rows, `ticket-trackers.md` recipe, README/concepts blurbs | Recipe steps executed once by hand end-to-end (at least the Linear variant) |

Each milestone is one conventional-commit-style PR (`feat: ticket metadata seam`,
`feat: postCreate/teardown lifecycle hooks`, `docs: ticket-trackers recipe + ticket docs`).

---

## 8. Risks & open items

- **`--ticket` flag parsing** — `cli.ts` currently treats flags as booleans; a value-taking flag
  is a small but real change to the arg loop. Keep it hand-rolled, don't add a dep.
- **Teardown-blocks-`rm` ergonomics** (T6) — aborting a destructive command on a hook failure is
  safe but could annoy; `--force` is the escape hatch. Revisit if it grates.
- **Prune skip-on-fail accumulation** (T6) — a permanently broken teardown (dead tracker token)
  means those branches never get pruned; the per-branch warning is the only signal. Acceptable
  for v1; a `prune --force` (skip hooks) escape hatch can be added if it bites.
- **`rm` from outside the worktree** — teardown env comes from `readDotenv(record.path)`; if the
  branch was never `up`'d there's no dotenv, so the hook runs with only the T7 vars. Document.
- **Pattern ambiguity** — first-match-wins on the regex; branches with multiple plausible IDs
  are the user's problem (recipe says so).
- **Deliberately out of scope**: any ticketing API call, ticket-state sync, `steck fleet`,
  webhooks. Those belong to the deferred fleet-orchestration layer (`plan.md` §12).
