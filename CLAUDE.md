# CLAUDE.md

Orientation for an AI agent (or a new contributor) working in this repo. Read this first so
you don't have to reverse-engineer the project from source. Canonical prose lives in `docs/`;
this file is the map and the conventions.

## What Steckling is

A CLI (`steck`) that gives **every git branch its own folder, its own isolated Docker service
stack, and its own injected environment**, so many branches — or many parallel Claude sessions —
can run side by side on one machine without colliding over ports, databases, or data.

It does exactly three things (see `docs/concepts.md`):

1. **A folder per branch** — a `git worktree` in `../{repo}-trees/<branch>/`.
2. **Private services per branch** — a separate `docker compose` project (own containers,
   volumes, network) on free host ports Steckling allocates.
3. **Env injection** — writes the per-branch connection URLs (`DATABASE_URL`, …) into a
   gitignored `.steckling/env` and runs your normal dev command with them loaded.

**Deliberate non-goals** (do not break these): it is *stack-agnostic* — the engine only ever
touches git, Docker, ports, and env vars, never a specific language/framework; the **app runs
natively on the host**, only *services* run in Docker; it is *not* a process manager (runs one
foreground `app.run`).

## Architecture — `engine/src/` module map

TypeScript on [Bun](https://bun.sh). One small, single-purpose module per concern.

| File | Responsibility |
| --- | --- |
| `cli.ts` | Arg parsing + command dispatch (the entrypoint). |
| `config.ts` | Load + validate `steckling.yml` (zod schema). |
| `init.ts` | `steck init` — interactive wizard that writes `steckling.yml` / `compose.steckling.yml`. |
| `naming.ts` | branch → slug + 6-char hash → stable compose project name. |
| `ports.ts` | Hash-preferred port-block allocation with free-scan fallback. |
| `registry.ts` | `~/.steckling/registry.json` — the single source of truth (locked, atomic writes). |
| `worktree.ts` | `git worktree` add/remove, `copyOnCreate` file copying. |
| `compose.ts` | `docker compose -p <project>` up/stop/down/port/status wrapper. |
| `env.ts` | Resolve service URLs, write `.steckling/env`, build child-process env. |
| `lifecycle.ts` | Orchestration for `new`/`up`/`tree`/`down`/`rm`/`prune`/`list`/`status`. |
| `hooks.ts` | Run the `provision`/`postCreate`/`teardown` hooks with injected env. |
| `ticket.ts` | Parse a ticket ID from the branch name (`ticket.pattern`), render `ticket.url`. |
| `mcp/server.ts` | Thin MCP wrapper over `lifecycle` + a `steckling://registry` resource. |
| `git.ts`, `sh.ts`, `capture.ts`, `log.ts`, `doctor.ts`, `version.ts` | git helpers, process exec, logging/colour, pre-flight checks, version. |

**Key seam:** `lifecycle.ts` resolves context from `steckling.yml`, then dispatches to the
`compose.ts` backend. The `registry.ts` `WorktreeRecord` (keyed by compose `project`) is the
state everything reconciles against — `steck list`/`status` and the MCP resource both read it,
and it's reconciled against `docker ps` on read so a crash can't desync it.

All commands in `cli.ts` are implemented — `up`/`down`/`new`/`list`/`status`/`rm`/`prune`/`mcp`
all dispatch to real code.

## Config contract — `steckling.yml`

The entire per-repo surface. Everything language-specific lives in hook strings and URL
templates; the engine stays stack-blind. Full reference: `docs/config-reference.md`. Key blocks:
`services.expose` (container port → env var → URL template, `{port}` = allocated host port),
`hooks.provision` (run once on first `up`, marked by `.steckling/.provisioned`), `app.run`
(native start command). A worked example is in `demo/`.

## Working in this repo

```sh
cd engine
bun install
bun run src/cli.ts <cmd>      # e.g. doctor, config — no build step in dev
bun run typecheck             # tsc --noEmit — MUST stay clean before pushing
bun run build                 # bun build --compile → ../dist/steck (release binary)

# End-to-end against real Docker (needs a NAMED branch, not detached HEAD):
git checkout -B my-test-branch
BUN=bun bash test/e2e.sh      # up → exec → list + the MCP smoke test
                              # (path is engine/test/e2e.sh — run it from engine/)
```

Requires **git + Docker + Bun**. CI (`.github/workflows/ci.yml`) runs typecheck, the dockerized
e2e, and cross-compiled binaries.

## Conventions & gotchas

- **Strict TypeScript**, small single-purpose modules. Keep `bun run typecheck` clean.
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:` …).
- **Keep the engine stack-agnostic** — never assume a language/framework; only git, Docker,
  ports, env.
- **Verify against Docker, not just the type-checker** — several past bugs only surfaced at
  runtime. Run `test/e2e.sh` for anything touching the lifecycle.
- Steckling **keys everything off the current git branch**; commands error on detached HEAD.
- `.steckling/` is **gitignored per-worktree runtime** (the written env + provisioned marker).
  The registry is global at `~/.steckling/registry.json`.

## Where to read more

- `docs/concepts.md` — the mental model · `docs/quickstart.md` — first run
- `docs/commands.md` · `docs/config-reference.md` · `docs/mcp.md` · `docs/troubleshooting.md`
- `docs/plan.md` — the full design + decisions; **§12 lists explicitly deferred work**
  (snapshot/fork fast-path, fleet orchestration) worth knowing before proposing features.
- `CONTRIBUTING.md` — dev setup, recipe format, release process.
