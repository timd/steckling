# Recipe: Ruby on Rails

Steckling doesn't know anything about Rails — you just point `app.run` and the hooks at the
usual Rails commands, and inject the connection via env.

## `steckling.yml`

```yaml
version: 1
worktrees:
  copyOnCreate:
    - config/master.key # gitignored; a fresh worktree needs it
services:
  compose: ./compose.steckling.yml
  expose:
    postgres:
      container: 5432
      env: DATABASE_URL
      url: "postgres://app:app@localhost:{port}/app"
    redis:
      container: 6379
      env: REDIS_URL
      url: "redis://localhost:{port}/0"
app:
  run: "bin/rails server -p $PORT"
  port:
    env: PORT
    base: 3000
hooks:
  provision: "bin/rails db:prepare && bin/rails db:seed"
```

## `compose.steckling.yml`

```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: app }
    ports: ["${STECKLING_PORT_POSTGRES:?}:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U app"], interval: 2s, retries: 15 }
  redis:
    image: redis:7-alpine
    ports: ["${STECKLING_PORT_REDIS:?}:6379"]
volumes:
  pgdata:
```

## Notes

- Rails reads `DATABASE_URL` and `REDIS_URL` directly, so nothing in `config/database.yml`
  needs to change.
- `bin/rails db:prepare` creates + migrates (and seeds via the hook) when the hook first runs;
  later `steck up`s skip provisioning.
- For a worker, add a second app or run it via `steck exec -- bin/sidekiq`.
