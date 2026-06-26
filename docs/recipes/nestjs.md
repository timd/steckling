# Recipe: NestJS

A typical Nest app with TypeORM + Postgres + Redis (BullMQ). Nest reads everything from the
environment via `@nestjs/config`, so there's no app code to change.

## `steckling.yml`

```yaml
version: 1
worktrees:
  copyOnCreate:
    - .env.local # gitignored local overrides a fresh worktree needs
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
      url: "redis://localhost:{port}"
app:
  run: "npm run start:dev"
  port:
    env: PORT
    base: 3000
hooks:
  provision: "npm run migration:run && npm run seed"
```

## `compose.steckling.yml`

```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: app }
    ports: ["${STECKLING_PORT_POSTGRES}:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U app"], interval: 2s, retries: 15 }
  redis:
    image: redis:7-alpine
    ports: ["${STECKLING_PORT_REDIS}:6379"]
volumes:
  pgdata:
```

## Notes

- **TypeORM / `@nestjs/config`** already reads `process.env.DATABASE_URL` — nothing changes.
  Steckling sets it in the environment, and `@nestjs/config` won't overwrite an already-set var, so
  the branch DB wins over a committed `.env`.
- **BullMQ / Redis**: each branch gets its own Redis container, so queue state is naturally
  isolated — no shared keyspace to partition.
- **Workers**: `app.run` runs one process (the API). Start a worker in a second terminal with
  `steck exec -- npm run start:worker`, which inherits the same branch env.
- **Migrations**: `npm run migration:run` runs once per branch on first boot; re-run with
  `steck up --reprovision` or ad-hoc via `steck exec -- npm run migration:run`.
