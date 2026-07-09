# Steckling documentation

Start here:

- **[Concepts](concepts.md)** — the mental model (worktree + per-branch Docker + env injection).
  Read this first.
- **[Install](install.md)** — script, Homebrew, from source.
- **[Quickstart](quickstart.md)** — `steck init` (or two files by hand), then `steck up`.
- **[Adopting an existing project](adopting-an-existing-project.md)** — the common case: bolting
  Steckling onto a repo you already have.

Reference:

- **[Commands](commands.md)** — every command and flag.
- **[`steckling.yml` reference](config-reference.md)** — every config field + placeholders.
- **[Deploy to Railway](deploy-railway.md)** — take a branch's agent off your machine (Path 1).
- **[MCP](mcp.md)** — driving the worktree fleet from Claude / other agents.
- **[Troubleshooting](troubleshooting.md)** — common problems and fixes.

Recipes:

- **[Recipes index](recipes/README.md)** — [Node/Nest](recipes/nestjs.md) ·
  [Rails](recipes/rails.md) · [Django](recipes/django.md) · [Go](recipes/go.md)

Project:

- **[Design notes & decisions](plan.md)** — why Steckling is built the way it is.
- **[Architecture decisions](adr/)** — ADRs (0001: the remote agent-deploy target).
- **[Manual testing checklist](testing-checklist.md)** — the CRUD-lifecycle regression script.
- **[Contributing](../CONTRIBUTING.md)** · **[Releasing](../RELEASING.md)**
