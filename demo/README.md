# Steckling demo

The smallest end-to-end Steckling setup: a Postgres service and a tiny [Bun](https://bun.sh) app
that reads `DATABASE_URL` and serves the rows it was seeded with. It's what the README's
quickstart and the CI end-to-end test exercise.

## Files

| File | Role |
| --- | --- |
| `steckling.yml` | exposes `postgres` → `DATABASE_URL`; `app.run` runs the server; provisions via `app/provision.ts` |
| `compose.steckling.yml` | the Postgres service (host port via `${STECKLING_PORT_POSTGRES}`) |
| `app/provision.ts` | creates + seeds a `widgets` table (the provision hook) |
| `app/server.ts` | HTTP server returning the widgets as JSON (the app) |
| `app/check.ts` | one-shot connectivity check (used by tests) |
| `app/add.ts` | inserts a widget — used to demonstrate per-branch isolation |

## Try it

From this directory, with `steck` installed (or `bun run ../engine/src/cli.ts`):

```sh
steck up                      # starts an isolated Postgres, seeds it, runs the app
steck exec -- bun run app/check.ts   # → widgets = alpha, beta, gamma
steck list
steck down
```

See the [quickstart](../docs/quickstart.md) for the full walkthrough, including running a second
branch in parallel.
