# Adopting Steckling in an existing project

You don't start a project *with* Steckling — you bolt it onto one you already have. This is the
normal case, and it's designed to drop in without restructuring anything.

## What you'll change (and what you won't)

You **add** two files and a `.gitignore` line. You **don't** rewrite code, move files, or change
how your app starts. The one prerequisite: your app must read its database connection (and any
other service URLs) **from environment variables**, not hardcoded — which is already the norm
for most frameworks.

Steckling creates **new, empty, per-branch databases** in their own Docker volumes. It does **not**
touch your existing local database or your current `docker-compose up`. They coexist on different
ports; retire your old setup whenever you're ready.

## Steps (with a NestJS example)

Assume a repo with a Nest app that reads `DATABASE_URL`, has `npm run migration:run` and
`npm run seed`, and starts with `npm run start:dev`.

### 1. Describe the services — `compose.steckling.yml`

If you already have a `docker-compose.yml` for local Postgres, this is nearly identical — the one
change is that the host port becomes a Steckling variable so each branch gets its own:

```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: app }
    ports: ["${STECKLING_PORT_POSTGRES}:5432"] # was "5432:5432"
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 2s
      timeout: 3s
      retries: 15
volumes: { pgdata: {} }
```

### 2. Add `steckling.yml`

Map the service to your env var and reuse your existing scripts as the provision hook:

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
  run: "npm run start:dev"
  port: { env: PORT, base: 3000 }
hooks:
  provision: "npm run migration:run && npm run seed"
```

### 3. Make sure the app reads `DATABASE_URL` from the environment

Most Nest apps already do, via `@nestjs/config` / `TypeOrmModule.forRootAsync`. If yours hardcodes
`host: 'localhost', port: 5432`, change that one place to read `process.env`. This is the only
possible code touchpoint.

Because Steckling sets `DATABASE_URL` in the process environment and `@nestjs/config`/dotenv won't
overwrite an already-set variable, the branch DB wins over a committed `.env` automatically.

### 4. Gitignore the runtime file

```sh
echo ".steckling/" >> .gitignore
```

### 5. Commit

Commit `steckling.yml`, `compose.steckling.yml`, and the `.gitignore` change. They travel with the
repo, so teammates and future worktrees get them for free.

## Then use it

Start in place, on your current branch — no worktree needed yet:

```sh
steck up      # fresh isolated Postgres, migrated + seeded, then npm run start:dev
```

When you want two branches at once, graduate to worktrees:

```sh
steck new feature/PLA-123
cd ../<repo>-trees/feature/PLA-123
steck up
```

## Bringing your existing data along (optional)

By default each branch starts from your `seed`. If you want real data, point the provision hook at
a restore step, or do it once per branch with `steck exec`:

```sh
# e.g. load a dump into this branch's DB
steck exec -- sh -c 'pg_restore -d "$DATABASE_URL" ./snapshot.dump'
```

## Checklist

- [ ] `compose.steckling.yml` with `${STECKLING_PORT_<SERVICE>}` host ports
- [ ] `steckling.yml` mapping services → env vars, `app.run`, `provision` hook
- [ ] app reads connection details from env
- [ ] `.steckling/` in `.gitignore`
- [ ] `steck doctor` is green, then `steck up`
