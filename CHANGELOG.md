# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
