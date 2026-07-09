<h1 align="center">Steckling</h1>

<p align="center">
  <strong>A git worktree + an isolated Docker service stack per branch.</strong><br>
  Run many branches in parallel — each with its own database, ports, and data — on one machine.
</p>

<p align="center">
  <a href="https://github.com/timd/steckling/actions/workflows/ci.yml"><img src="https://github.com/timd/steckling/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Linux-supported-success" alt="Platforms">
</p>

---

Your code switches branches in a second. Your **database** doesn't. Work on a feature, get
pulled onto a hotfix, and suddenly you're juggling one shared Postgres — migrating it back and
forth, wiping data, fighting over port 5432. Running two branches at once is basically off the
table.

**Steckling gives every branch its own everything.** Its own folder, its own Postgres (and Redis,
or whatever your app needs), its own data, on its own ports. Switching branches is switching
folders. Running three at once is three terminals. Nothing collides.

```
  ../myapp-trees/feature-a/   steck up  →  postgres :31140   (feature-a's own data)
  ../myapp-trees/feature-b/   steck up  →  postgres :44870   (feature-b's own data)
         main/                steck up  →  postgres :20030
                              ~/.steckling/registry.json tracks them all
```

It's **stack-agnostic**: your app runs natively the way it always has (`npm run dev`, `rails s`,
`go run`, …). Steckling only ever deals with git, Docker, and environment variables — it spins up
each branch's services and hands your app the connection strings. It works for any language that
reads its config from the environment.

## How it works

Three moving parts, and deliberately nothing more:

1. **A folder per branch** — via `git worktree`, each branch lives in its own directory.
2. **Private services per branch** — a separate `docker compose` project per branch (own
   containers, own volumes, a free host port Steckling picks for you).
3. **Env injection** — Steckling writes the right `DATABASE_URL` (etc.) into a gitignored file your
   app reads, then runs your normal dev command.

Steckling never runs your app for you and knows nothing about your framework. → [Concepts](docs/concepts.md)

## Install

> Requires **git** and **Docker**. The CLI is a single self-contained binary — no runtime to install.

```sh
# install script (downloads a binary to ~/.local/bin)
curl -fsSL https://raw.githubusercontent.com/timd/steckling/main/install.sh | sh

# or Homebrew
brew install timd/steckling/steckling
```

From source ([Bun](https://bun.sh)): `bun run engine/src/cli.ts <command>`. → [Install guide](docs/install.md)

Then check your machine: `steck doctor`.

## Quickstart

Let the wizard set everything up — it detects your run command, offers service presets
(Postgres, MySQL, Redis, Mongo, RabbitMQ), and writes both config files plus the
`.gitignore` entry:

```sh
steck init
```

Or add the two files by hand — a services compose file and a `steckling.yml`:

```yaml
# steckling.yml
version: 1
services:
  compose: ./compose.steckling.yml
  expose:
    postgres: { container: 5432, env: DATABASE_URL, url: "postgres://app:app@localhost:{port}/app" }
app:
  run: "npm run dev" # any language
hooks:
  provision: "npm run migrate && npm run seed"
```

```yaml
# compose.steckling.yml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: app }
    ports: ["${STECKLING_PORT_POSTGRES}:5432"] # Steckling injects the host port
    volumes: [pgdata:/var/lib/postgresql/data]
volumes: { pgdata: {} }
```

Then:

```sh
steck up               # start this branch: services + provision + run the app
steck new feature/x    # a second branch, in its own folder…
cd ../myapp-trees/feature/x
steck up               # …with its own DB, running in parallel
steck list             # see every worktree, its status + ports
```

Full walkthrough → [Quickstart](docs/quickstart.md) · already have a project? → [Adopting an existing project](docs/adopting-an-existing-project.md)

## Commands

| | |
| --- | --- |
| `steck init` | Set up a repo interactively — presets, detection, both files written for you |
| `steck new <branch> [base]` | Create a worktree + allocate its service ports |
| `steck up [--no-run]` | Bring up services, provision once, run the app |
| `steck down` | Stop the containers, keep the data |
| `steck list` / `status` | What's registered, running, and on which ports |
| `steck exec -- <cmd>` | Run a command wired to this branch's env (e.g. `sh -c 'psql "$DATABASE_URL"'`) |
| `steck rm` / `prune` | Reclaim a branch's stack / bulk-reclaim merged branches (`--purge`: folder + branch too) |
| `steck deploy [--dry-run]` | Ship this branch's agent to Railway → [guide](docs/deploy-railway.md) |
| `steck logs` / `destroy` | Tail or tear down the deployed agent |
| `steck mcp` | Run the MCP server so Claude can drive the fleet |
| `steck doctor` / `config` | Check the environment / validate `steckling.yml` |

Full reference → [Commands](docs/commands.md)

## Drive it from Claude (MCP)

`steck mcp` exposes the fleet to AI agents as MCP tools (`steckling_new`, `steckling_up`,
`steckling_list`, …) plus a live `steckling://registry` resource. Because branches are fully
isolated, you can point a separate Claude session at each one and let them work in parallel.
→ [MCP guide](docs/mcp.md)

## Documentation

- [Concepts](docs/concepts.md) — the mental model
- [Install](docs/install.md) · [Quickstart](docs/quickstart.md) · [Adopting an existing project](docs/adopting-an-existing-project.md)
- [Commands](docs/commands.md) · [`steckling.yml` reference](docs/config-reference.md)
- [Deploy an agent to Railway](docs/deploy-railway.md) — take a branch's agent off your machine
- [MCP](docs/mcp.md) · [Troubleshooting](docs/troubleshooting.md)
- Recipes: [Node/Nest](docs/recipes/nestjs.md) · [Rails](docs/recipes/rails.md) · [Django](docs/recipes/django.md) · [Go](docs/recipes/go.md)
- [Design notes & decisions](docs/plan.md)

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The engine is TypeScript on
[Bun](https://bun.sh); `cd engine && bun install && bun run typecheck`.

## License

[MIT](LICENSE) © Tim Duckett
