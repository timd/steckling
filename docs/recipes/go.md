# Recipe: Go

## `steckling.yml`

```yaml
version: 1
services:
  compose: ./compose.steckling.yml
  expose:
    postgres:
      container: 5432
      env: DATABASE_URL
      url: "postgres://app:app@localhost:{port}/app?sslmode=disable"
app:
  run: "go run ./cmd/server"
  port:
    env: PORT
    base: 8080
hooks:
  # migrate with your tool of choice, e.g. goose / golang-migrate / a make target
  provision: "make migrate && make seed"
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
volumes:
  pgdata:
```

## Notes

- Your server reads `DATABASE_URL` and `PORT` from the environment — the standard Go
  `os.Getenv` pattern. Nothing Steckling-specific in your code.
- `go run` recompiles on each `steck up`; for a faster inner loop pair it with `air` or
  `wgo` as the `run` command (`run: "air"`).
- Run one-off tooling against the branch DB with `steck exec -- psql $DATABASE_URL` or
  `steck exec -- go run ./cmd/migrate`.
