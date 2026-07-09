# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`steck tree`** — a per-branch cockpit TUI, delegated to [mprocs](https://github.com/pvolok/mprocs):
  an app pane running `app.run` with the branch env (start/stop/restart from the TUI) plus a live
  log pane per compose service. Generated per run at `.steckling/mprocs.yaml`; services stay
  Docker-managed; `steck doctor` soft-checks for mprocs.
- **`steck init`** — interactive setup wizard. Service presets (Postgres, MySQL, Redis,
  MongoDB, RabbitMQ) or adoption of an existing compose file, a run command detected from the
  repo (`package.json`, `Cargo.toml`, `go.mod`, …), `.env*` files offered for `copyOnCreate`,
  a generated `compose.steckling.yml`, the `.gitignore` entry, and a validation round-trip of
  everything written. `--yes` for a non-interactive default setup.
- **`--purge` for `rm` and `prune`** — additionally remove the worktree folder and delete the
  git branch, with safety refusals kept as warnings: dirty folders are kept (override with
  `--force` on `rm`), branches are only force-deleted when verified merged, and empty parent
  dirs from slashed branch names are swept. `prune --purge` is the post-merge one-liner that
  leaves nothing behind.
- **Unregistered worktrees in `steck list`** — git worktrees of the current repo with no
  steckling stack (e.g. after a plain `rm`) now show dimmed as `unreg`; `rm --purge` can
  reclaim them.
- **Remote agent deploy (Railway)** — ship a branch's agent to Railway as a long-running or
  scheduled service. New optional `agent`/`deploy` blocks in `steckling.yml`, new commands
  `deploy` (`--dry-run`, `--status`), `logs`, and `destroy`, a generated `railway.json`
  (config-as-code), a `railway` check in `doctor`, and a runnable demo agent. See
  [docs/deploy-railway.md](docs/deploy-railway.md) and
  [ADR 0001](docs/adr/0001-remote-agent-target.md). Path 1 of
  [the remote-agents plan](docs/plan-remote-agents.md); ephemeral sandboxes are next.

### Fixed

- **Env leak**: Bun auto-loaded a worktree's `.env`/`.env.local` into steckling's own process
  environment and passed it to every child (app, hooks, `exec`), silently bypassing explicit
  env injection. Disabled via `--no-compile-autoload-dotenv` / `--no-env-file`.
- **`steck down` stops what's actually running** — by compose-project label instead of the
  compose file, so an edited or emptied file can no longer strand running containers.
- **`prune` is repo-scoped** — records of other repos are no longer judged against the current
  repo's branches (which could wrongly destroy them); a record from another repo is only
  reclaimed when that repo's folder is gone (new reason: "repo folder missing").
- **Brand-new repos** — commands work on an unborn branch (fresh `git init` before the first
  commit), and `steck new` explains that a commit-less base can't be branched from instead of
  surfacing a raw git fatal.
- **Services-less setups** — a compose file with no services (e.g. `init` with no presets) is
  valid: `up` skips Docker and still injects the app port and env.

### Changed

- Provision-hook semantics documented as they actually are: the hook runs once per stack,
  tracked by a marker written after its first successful run — so a hook added to an existing
  stack still runs on the next `up`.

## [0.1.0] - 2026-06-05

Initial release.

### Added

- **Per-branch isolation** — each git branch gets its own git worktree and its own Docker
  Compose project (own containers, volumes, and host ports).
- **Config-driven, stack-agnostic engine** — a single `steckling.yml` (services + env mapping +
  `app.run` + shell hooks) drives any stack; the engine only touches git, Docker, ports, and env.
- **Commands** — `new`, `up` (`--no-run`, `--reprovision`), `down`, `list`, `status`,
  `exec`, `rm` (with a base-branch guard), `prune`, `config`, `doctor`.
- **Registry** at `~/.steckling/registry.json` — stable per-branch host ports and a single source
  of truth, reconciled against Docker.
- **Provisioning** — the `provision` hook runs once on first boot (tracked per worktree).
- **MCP server** (`steck mcp`) — exposes the fleet to agents as tools (`steckling_new`,
  `steckling_up`, `steckling_down`, `steckling_list`, `steckling_status`) plus a `steckling://registry`
  resource.
- **Docs & recipes** — concepts, install, quickstart, adoption guide, command + config reference,
  troubleshooting, and recipes for NestJS, Rails, Django, and Go.
- **Distribution** — install script and Homebrew formula; self-contained binaries for
  macOS (arm64/x64) and Linux (x64); Windows via WSL2.

[Unreleased]: https://github.com/timd/steckling/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/timd/steckling/releases/tag/v0.1.0
