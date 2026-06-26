# Steckling — Implementation Plan

**CLI:** `steckling` · **Status:** plan / pre-build · **Date:** 2026-06-04

Steckling is a standalone, open-source tool that gives **every git branch its own folder, its
own isolated Docker service stack, and its own injected environment** — so a developer (or a
fleet of Claude sessions) can run many branches in parallel on one machine, each fully
isolated. It is **stack-agnostic** (works for Node, Rails, Django, Go, …) and
**deployment-agnostic**: the engine never touches your app's build or runtime, it only wires
up isolated services and hands your app the connection details.

> This plan is the output of a structured design session. The "Decisions locked" table is the
> contract; everything below it is the design that follows from those decisions.

---

## 1. What we're building (one paragraph)

`steckling` is a single-binary CLI + thin MCP server, configured by one declarative file per
repo (`steckling.yml`). For each git branch it: (a) creates a **git worktree** in a sibling
folder, (b) brings up a **per-branch Docker Compose project** (own Postgres/Redis/whatever,
own volumes, own host ports), (c) writes the per-branch connection info into a gitignored
**dotenv** the app reads, and (d) runs a **project-supplied start command** natively on the
host. A global **registry** tracks every worktree's ports and status, and is exposed both to
`steck list` and to an **MCP resource** so a Claude session can introspect the fleet.

---

## 2. Decisions locked

| #   | Decision                | Choice                                                                                                                                                  | Why                                                                                                                        |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Isolation model**     | Per-branch **physical** Docker stacks (own containers/volumes/ports)                                                                                    | Most generic — works for any app by injecting connection URLs; no app cooperation on naming needed.                        |
| 2   | **Where the app runs**  | **On the host** (native), services in Docker                                                                                                            | Native hot-reload/debug on macOS (no bind-mount watch tax); smallest contract; most portable across stacks.                |
| 3   | **Worktree layout**     | One git worktree per branch, sibling folder `../{repo}-trees/<branch>/`                                                                                 | Branch-per-folder; the worktree stays a plain native folder Claude can touch directly.                                     |
| 4   | **Form factor**         | **Config-driven engine** (manifest + shell hooks), not a fork-template, not per-language templates                                                      | Clean update path; truly stack-agnostic; one engine, many repos.                                                           |
| 5   | **Engine runtime**      | **TypeScript + Bun** — `bun run` in dev (no build step), `bun build --compile` to a dependency-free binary for release                                  | A language the owner can read/debug/extend; no Node required on target; no toolchain hell.                                 |
| 6   | **Data/seeding**        | **Run the project's `provision` hook every time** (migrate + seed)                                                                                      | Simplest, fully generic. Volume-snapshot cloning deferred to a future fast-path (see §12).                                 |
| 7   | **Claude workflow**     | **Claude-per-worktree** + a thin **MCP server** exposing new/up/down/list/status + a live-state resource                                                | Matches Claude Code's model; robust; modest build. Fleet orchestration deferred (registry/MCP designed to allow it later). |
| 8   | **Ports & state**       | **Registry-backed allocation**: prefer a hash-derived block, free-scan fallback, persist to global `~/.steckling/registry.json`; stable thereafter        | Stable + collision-safe + introspectable; registry is the single source of truth for `list` + MCP.                         |
| 9   | **Lifecycle / cleanup** | **Explicit** `up` / `down` (stop, keep data) / `rm` (destroy, confirm) / `list`, plus manual `prune` (reports merged/dead branches, removes on confirm) | Predictable & safe — data dies only on explicit confirmation; `down`≠`rm` gives cheap RAM reclaim.                         |
| 10  | **Env injection**       | **Gitignored `.steckling/env` dotenv** written into the worktree + loaded for `run`/hooks; `steck exec -- <cmd>` for ad-hoc tools                       | Works for both the managed run command and manual tools (psql, scripts); inspectable.                                      |
| 11  | **Platforms**           | **macOS + Linux** native binaries (darwin-arm64/x64, linux-x64); **Windows via WSL2** (documented, not a native target)                                 | Sidesteps Bun's rougher native-Windows compile; covers ~all dev machines.                                                  |
| 12  | **v1 OSS deliverable**  | **Engine + 1 runnable demo** (tiny app + Postgres + Redis) + **config recipes** for Rails/Django/Go (snippets, not full apps)                           | Proves it works _and_ proves it's agnostic, without maintaining N example apps.                                            |

---

## 3. Topology

```
DEVELOPER MACHINE (one Docker engine)
│
├─ ../myapp-trees/feat-a/             ← git worktree (branch feat-a)
│     .steckling/env  →  DATABASE_URL=…:5440  REDIS_URL=…:6390
│     $ steck up    # app runs natively here (pnpm dev / rails s / go run …)
│        │ injects .steckling/env, execs `run`
│        ▼
│     compose -p steckling_feat_a   (services only)
│       postgres:5440   redis:6390   localstack:4570   [vols: steckling_feat_a_*]
│
├─ ../myapp-trees/feat-b/             ← git worktree (branch feat-b)
│     .steckling/env  →  DATABASE_URL=…:5441  REDIS_URL=…:6391
│     compose -p steckling_feat_b
│       postgres:5441   redis:6391   localstack:4571   [vols: steckling_feat_b_*]
│
└─ ~/.steckling/registry.json  ← all worktrees, their port blocks, status (MCP source of truth)
```

Each branch is fully isolated: separate containers, separate volumes, separate ports. Only
the Docker engine itself is shared. Two stacks run side by side without collision.

---

## 4. The config contract (`steckling.yml`)

The _entire_ per-repo surface. Everything language-specific lives in hooks/strings; the
engine itself is stack-blind.

```yaml
# steckling.yml — lives at the repo root, committed
version: 1

worktrees:
  dir: "../{repo}-trees" # where worktrees are created ({repo} = repo folder name)
  base: "main" # default base branch for `steck new`
  copyOnCreate: # gitignored local files a fresh worktree lacks
    - .env.local
    - config/service-account.json

services:
  compose: ./compose.steckling.yml # the per-branch service stack (any services)
  # which container ports get a published host port + which env var receives the URL
  expose:
    postgres:
      container: 5432
      env: DATABASE_URL
      url: "postgres://app:app@localhost:{port}/app" # {port} = allocated host port
    redis:
      container: 6379
      env: REDIS_URL
      url: "redis://localhost:{port}"
    localstack:
      container: 4566
      env: AWS_S3_ENDPOINT
      url: "http://localhost:{port}"

env:
  mode: dotenv # writes .steckling/env (the locked choice)
  extra: # static or templated vars merged in
    NODE_ENV: development
    APP_URL: "http://localhost:{app_port}"

app:
  run: "pnpm dev" # how to start the app natively (any language)
  port: # optional: app's own host port (for APP_URL etc.)
    env: PORT
    base: 3000

hooks:
  provision: "pnpm db:migrate && pnpm db:seed" # after services healthy, before/independent of run
  teardown: "" # optional, before `rm`
```

**Port templating:** `{port}` resolves per service from the allocated block; `{app_port}` is
the app's own allocated host port. The engine never edits config files at runtime — it only
computes values and writes `.steckling/env` + sets the child process env.

---

## 5. Engine design (TypeScript + Bun)

### Command surface

| Command                       | Behaviour                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `steck new <branch> [base]` | Create worktree (from `origin/<base>`), copy `copyOnCreate` files, allocate port block, write `.steckling/env`. Optionally `--up` to immediately bring services up + provision. |
| `steck up`                  | In a worktree: bring its compose project up, wait for health, run `provision` hook if first boot, write/refresh `.steckling/env`, exec `run`.                                   |
| `steck down`                | Stop the branch's containers (`docker compose stop`) — frees RAM, **keeps volumes/data**.                                                                                     |
| `steck rm [branch]`         | Remove containers **+ volumes** + registry entry (confirmation required; refuses to touch a protected/base project). Leaves the worktree folder + git branch.                 |
| `steck list`                | Table of all worktrees: branch, path, status (up/down), port block, last used. Reads the registry.                                                                            |
| `steck status`              | Detailed status of the current (or named) worktree — container health, ports, env.                                                                                            |
| `steck exec -- <cmd>`       | Run an arbitrary command with this branch's `.steckling/env` loaded (e.g. `steck exec -- psql $DATABASE_URL`).                                                                |
| `steck prune`               | Report worktrees whose git branch is merged/deleted upstream; remove (stacks + volumes + worktree) only on confirm.                                                           |
| `steck doctor`              | Pre-flight: docker reachable? bun? git version? config valid? port range sane?                                                                                                |
| `steck mcp`                 | Start the MCP server (stdio) exposing the operations + registry resource.                                                                                                     |

### Module layout

```
engine/
  src/
    cli.ts              # arg parsing + dispatch (the bun entrypoint)
    config.ts           # load + validate steckling.yml (zod schema)
    naming.ts           # branch → slug + 6-char hash → compose project name
    ports.ts            # hash-preferred block, free-scan fallback, persist
    registry.ts         # ~/.steckling/registry.json read/write, locking, GC of stale entries
    worktree.ts         # git worktree add/remove, copyOnCreate, base resolution
    compose.ts          # docker compose -p <project> up/stop/down/port/health
    env.ts              # compute vars, write .steckling/env, build child env for exec
    lifecycle.ts        # new/up/down/rm/prune orchestration
    hooks.ts            # run provision/teardown with injected env
    mcp/server.ts       # thin MCP wrapper over lifecycle + registry resource
    doctor.ts
  package.json          # bun, zod; build script: bun build --compile
```

### Naming

- `slug = lowercase(branch) → non-alnum to '-' → trim → cap 24 chars`
- `hash6 = sha1(branch)[0:6]` (disambiguates slug collisions)
- `project = steckling_<slug>_<hash6>` (Docker Compose `-p`, `_` separators)
- Stable and deterministic from the branch name alone — a proven hashing strategy, repointed
  from logical DB names to compose project names.

### Port allocation

- A worktree owns a **contiguous block** sized to `len(services.expose) + (app.port ? 1 : 0)`.
- Preferred block start = `BASE + (hash_int % N) * blockSize` (stable per branch).
- If any port in the preferred block is in use → free-scan forward to the next free block.
- Persist `{branch, project, block, services:{name:port}, app_port}` to the registry; reuse on
  subsequent `up` (stable ports across restarts).
- Free-check via a robust probe: `lsof` → `nc` → a socket-connect fallback.

---

## 6. Registry & state (`~/.steckling/registry.json`)

```jsonc
{
  "version": 1,
  "worktrees": {
    "steckling_feat_a_5f3298": {
      "branch": "feat-a",
      "repo": "/Users/you/code/myapp",
      "path": "/Users/you/code/myapp-trees/feat-a",
      "ports": {
        "postgres": 5440,
        "redis": 6390,
        "localstack": 4570,
        "app": 3010,
      },
      "status": "up", // up | down | unknown (reconciled against docker on read)
      "createdAt": "…",
      "lastUsedAt": "…",
    },
  },
}
```

- **Single source of truth** for `steck list` and the MCP resource.
- **Reconciled** against `docker ps` on read so a crash/manual `docker rm` can't desync it.
- File-locked on write (single-user, but `new`/`up` can race across terminals).
- Stale-entry GC: entries whose worktree path no longer exists are flagged by `prune`.

---

## 7. MCP server (`steck mcp`)

A thin adapter over the same lifecycle functions — **no business logic of its own**.

- **Tools:** `steckling.new`, `steckling.up`, `steckling.down`, `steckling.rm`, `steckling.list`,
  `steckling.status`, `steckling.exec`. Structured JSON in/out so non-CLI clients (Cursor, Claude
  Desktop) work too.
- **Resource:** `steckling://registry` — the live registry (branches, ports, status), so a Claude
  session can read the fleet state without shelling out.
- **Designed for fleet orchestration later:** because all state is in the registry and the MCP
  is a thin wrapper, a future "orchestrator Claude" (deferred) can be layered on top with no
  engine rework.

> Day-one usage needs no MCP — Claude Code can just run the `steckling` CLI via Bash. MCP adds
> structured access + a state resource + cross-client reach.

---

## 8. Repo structure (the open-source deliverable)

```
steckling/                     # this repo
  engine/                    # the steckling CLI (TS + Bun) — §5
  demo/                      # ONE runnable end-to-end example
    app/                     #   tiny app (Bun/Node) that reads DATABASE_URL/REDIS_URL
    compose.steckling.yml      #   Postgres + Redis
    steckling.yml              #   wired config — copy-paste starting point
  docs/
    plan.md                  # this document
    quickstart.md
    config-reference.md
    mcp.md                   # how to register `steck mcp` with Claude Code / Desktop
    recipes/
      rails.md  django.md  go.md   # config snippets proving agnosticism (no full apps)
  .github/workflows/         # CI: build binaries (3 targets) + run the demo loop smoke test
  README.md
```

**CI smoke test** = the agnosticism/regression guard: spin the demo worktree up, assert the app
connects to its branch DB, tear it down. The one app we maintain proves the whole loop.

---

## 9. Build & distribution

- **Dev:** `bun run engine/src/cli.ts <args>` — zero build step.
- **Release:** `bun build engine/src/cli.ts --compile --target=bun-<os>-<arch> --outfile steck`
  for `darwin-arm64`, `darwin-x64`, `linux-x64`. Attach binaries to GitHub Releases.
- **Install:** Homebrew tap (`brew install steckling`) + `curl | sh` script + raw release download.
- **Deps on the target machine:** `git` + `docker` only. (Bun runtime is baked into the binary.)

---

## 10. Worktree bootstrap flow (the `steck new` happy path)

1. Validate config + `steck doctor` pre-flight (docker up, git clean enough, ports sane).
2. `git fetch origin <base>`; resolve start point (`origin/<base>` or local `<base>`).
3. `git worktree add -b <branch> ../<repo>-trees/<branch> <start-point>`.
4. Copy `copyOnCreate` files from the primary checkout into the new worktree.
5. Allocate + persist the port block (registry).
6. (If `--up`) `docker compose -p <project> up -d` → wait for health → write `.steckling/env` → run
   `provision` hook → `exec run`.
7. Print the resolved ports + the one command to start it (`cd … && steck up`).

---

## 11. Milestones (suggested build order)

- **M0 — Skeleton:** repo, `engine/` Bun project, `cli.ts` dispatch, `config.ts` (zod), `doctor`.
- **M1 — Core loop (single branch):** `naming` + `ports` + `compose up/stop/down` + `env` dotenv +
  `exec` + `provision` hook. Prove `steck up` runs the demo app against a branch DB.
- **M2 — Worktrees + multi-branch:** `worktree.ts` (`new`, `copyOnCreate`), `registry.ts`,
  parallel branches on distinct port blocks. `list`/`status`.
- **M3 — Lifecycle & safety:** `down`/`rm` (stop vs destroy + confirm + base-guard), `prune`.
- **M4 — MCP:** `steck mcp` tools + `steckling://registry` resource; Claude Code registration docs.
- **M5 — Demo + recipes + CI:** runnable demo, Rails/Django/Go recipes, 3-target binary build +
  demo smoke test in CI.
- **M6 — Release:** Homebrew tap, install script, README, quickstart, versioned release.

---

## 12. Explicitly deferred (designed-for, not built in v1)

- **Snapshot fast-path** (decision #6): `steck snapshot` to save a golden seeded volume, then
  `steck new --from-snapshot` clones the volume (seconds) instead of re-seeding (minutes). The
  big speed win physical isolation unlocks; left out of v1 for simplicity.
- **Fleet orchestration** (decision #7): an orchestrator Claude that spawns/dispatches/tracks a
  fleet of worker sessions across branches. Registry + MCP are designed to allow it.
- **Auto-GC on merge/delete** (decision #9): kept manual (`prune`) for safety in v1.
- **Native Windows binary** (decision #11): WSL2 only for now.
- **Non-Node demo apps verified in CI** (decision #12): recipes are documented, not CI-run.

---

## 13. Open items to settle during build

- **Health-wait strategy** — rely on compose `healthcheck` + `--wait`, or poll? (Lean on compose
  `--wait` where available, fall back to a port/health poll.)
- **`.steckling/` directory** — confirm `steck new` adds it to the project's `.gitignore` (and that
  `.steckling/env` never gets committed).
- **Concurrency** — registry file-locking semantics when two `steck up` start in the same instant
  (lock properly, or accept "re-run on the rare race").
- **Short alias** — `steckling` is the binary; decide whether to ship a shorter alias (`tr` collides
  with coreutils, so likely not).

```

```
