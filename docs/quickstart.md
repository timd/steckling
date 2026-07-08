# Quickstart

Get a branch running with its own isolated database in about two minutes.

## 1. Prerequisites

- **Docker** (running)
- **git**
- A release binary of `steckling` on your PATH, **or** [Bun](https://bun.sh) + this repo
  (run via `bun run engine/src/cli.ts …`).

Check your environment:

```sh
steck doctor
```

## 2. Add two files to your repo

The fast way — answer a few prompts and both files (plus the `.gitignore` entry) are written
for you:

```sh
steck init
```

Or by hand:

**`steckling.yml`** (at the repo root):

```yaml
version: 1
services:
  compose: ./compose.steckling.yml
  expose:
    postgres:
      container: 5432
      env: DATABASE_URL
      url: "postgres://app:app@localhost:{port}/app"
app:
  run: "npm run dev" # your app's start command — any language
hooks:
  provision: "npm run migrate && npm run seed"
```

**`compose.steckling.yml`** — your per-branch services. Publish host ports via the
`STECKLING_PORT_<SERVICE>` variables Steckling injects:

```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: app }
    ports: ["${STECKLING_PORT_POSTGRES:?injected by steckling}:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 2s
      timeout: 3s
      retries: 15
volumes:
  pgdata:
```

Add `.steckling/` to your `.gitignore`.

## 3. Run the current branch

```sh
steck up          # starts services, provisions on first boot, runs your app
steck up --no-run # same, but don't start the app (just bring services up)
```

Your app starts with `DATABASE_URL` pointed at this branch's own Postgres. Stop with
Ctrl-C; `steck down` stops the containers but keeps the data.

## 4. Work on another branch in parallel

```sh
steck new feature/checkout-v2     # creates ../<repo>-trees/feature/checkout-v2
cd ../<repo>-trees/feature/checkout-v2
steck up                          # its own DB, its own ports — runs beside the first
```

```sh
steck list        # every worktree, its status + ports
steck status      # detail for the current worktree
```

## 5. Clean up

```sh
steck down            # stop, keep data
steck rm              # destroy this branch's containers + volumes (asks first)
steck prune           # reclaim merged/deleted branches' stacks (asks first)
steck prune --purge   # …and also remove their worktree folders + git branches
```

## Run many branches at once

Each branch gets its own compose project, volumes, and a free host-port block (stable per
branch, recorded in `~/.steckling/registry.json`). Two `steck up`s in two worktrees run
side by side without colliding.

See the [config reference](config-reference.md) for every option and
[mcp.md](mcp.md) to let Claude drive the fleet.
