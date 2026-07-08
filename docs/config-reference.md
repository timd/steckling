# `steckling.yml` reference

One file per repo, at the repo root (Steckling searches the current directory and its
parents). The engine is stack-blind — everything language-specific is a shell string.

```yaml
version: 1 # required, must be 1

worktrees:
  dir: "../{repo}-trees" # where `steck new` puts worktrees; {repo} = repo folder name
  base: "main" # default base branch for `steck new`
  copyOnCreate: # gitignored local files copied into each new worktree
    - .env.local

services:
  compose: ./compose.steckling.yml # the per-branch service stack (any compose file)
  expose: # which services get a published host port + an injected URL
    postgres:
      container: 5432 # the in-container port
      env: DATABASE_URL # env var the app reads
      url: "postgres://app:app@localhost:{port}/app" # {port} → allocated host port
    redis:
      container: 6379
      env: REDIS_URL
      url: "redis://localhost:{port}"

env:
  mode: dotenv # only "dotenv" is implemented (writes .steckling/env)
  extra: # extra vars merged into the env (static or templated)
    NODE_ENV: development
    APP_URL: "http://localhost:{app_port}"

app:
  run: "npm run dev" # how to start the app natively (any language)
  port: # optional: allocate a host port for the app itself
    env: PORT
    base: 3000

hooks:
  provision: "npm run migrate && npm run seed" # run once on first boot (and on --reprovision)
  postCreate: "" # optional; runs after `steck new` creates the worktree
  teardown: "" # optional; runs before `steck rm`/`steck prune` destroy the stack

# Ticket identity (optional, opt-in). Steckling parses the ticket ID out of the
# branch name, remembers it, shows it in `steck list`, and injects it into hooks
# and the app as $STECKLING_TICKET. It never calls the tracker's API.
ticket:
  pattern: "eng-\\d+" # regex, matched case-insensitively against the branch name
  url: "https://linear.app/acme/issue/{ticket}" # optional; must contain {ticket}
  env: STECKLING_TICKET # optional; the env var name the ID is injected under

# Remote agent deploy (optional — Path 1; see deploy-railway.md)
agent:
  kind: service # service (always-on) | scheduled (cron)
  start: "bun run agent.ts" # start command for the deployed container
  build:
    dockerfile: ./Dockerfile
  preDeploy: "" # optional command run before the container starts
  schedule: "0 9 * * *" # required for kind: scheduled (5-field cron, UTC, ≥5m)

deploy:
  target: railway
  project: my-agent # optional; else link a project once via the railway CLI
  needs: [postgres] # managed databases to provision on Railway
  env: # variables pushed to Railway (${VARS} expand from your shell)
    ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"
```

## Field detail

| Field | Required | Default | Notes |
| --- | --- | --- | --- |
| `version` | yes | — | Must be `1`. |
| `worktrees.dir` | no | `../{repo}-trees` | `{repo}` expands to the repo folder name. |
| `worktrees.base` | no | `main` | Default base for `steck new`; protected from `rm`. |
| `worktrees.copyOnCreate` | no | `[]` | Paths (relative to repo root) copied into new worktrees. |
| `services.compose` | yes | — | Path to the compose file, relative to `steckling.yml`. |
| `services.expose.<name>.container` | yes | — | Container port to publish. |
| `services.expose.<name>.env` | yes | — | Env var that receives the connection URL. |
| `services.expose.<name>.url` | yes | — | URL template; **must** contain `{port}`. |
| `env.mode` | no | `dotenv` | `dotenv` writes `.steckling/env`. |
| `env.extra` | no | `{}` | Extra env vars; values may use `{app_port}`. |
| `app.run` | yes | — | Start command, run via `sh -c` with the branch env. |
| `app.port.env` / `app.port.base` | no | — | Allocate + inject a host port for the app. |
| `hooks.provision` | no | `""` | Runs once after services are healthy (tracked by `.steckling/.provisioned`). |
| `hooks.postCreate` | no | `""` | Runs in the new worktree after `steck new` (identity env only — no services yet). A failure warns; the worktree is kept. |
| `hooks.teardown` | no | `""` | Runs before `steck rm` / `steck prune` destroy a stack. A failure aborts `rm` (unless `--force`) and skips that branch in `prune`. |
| `ticket.pattern` | no | — | Regex; first match against the branch name (case-insensitive — JS regexes have no inline `(?i)`) becomes the ticket ID. No block → no parsing. |
| `ticket.url` | no | — | Link template; **must** contain `{ticket}`. Rendered into `STECKLING_TICKET_URL` and `steck status`. |
| `ticket.env` | no | `STECKLING_TICKET` | Env var name the ticket ID is injected under. |
| `agent` | no | — | Optional; enables `steck deploy`. See [Deploy to Railway](deploy-railway.md). |
| `agent.kind` | no | `service` | `service` (always-on) or `scheduled` (cron; needs `schedule`). |
| `agent.start` | yes† | — | Container start command (†required when `agent` is set). |
| `agent.build.dockerfile` | no | `./Dockerfile` | Dockerfile that builds the agent image. |
| `agent.preDeploy` | no | — | Command run before the container starts (Railway `preDeployCommand`). |
| `agent.schedule` | no | — | 5-field cron (UTC, ≥5 min); required when `kind: scheduled`. |
| `deploy.target` | yes† | — | `railway` (†required when `deploy` is set). |
| `deploy.project` | no | — | Railway project name; else link once via the `railway` CLI. |
| `deploy.needs` | no | `[]` | Managed databases to provision (`postgres`, `redis`, …). |
| `deploy.env` | no | `{}` | Variables pushed to Railway; `${VAR}` expands from your shell. |

Unknown keys are rejected (strict validation) — run `steck config` to validate and print
the resolved config.

The `agent` and `deploy` blocks are optional and power `steck deploy` — see
[Deploy to Railway](deploy-railway.md).

## How values reach your app

For each exposed service, Steckling:

1. allocates a free host port (preferring a stable, branch-hash-derived block),
2. sets `STECKLING_PORT_<SERVICE_NAME>` so your compose file can publish it
   (`ports: ["${STECKLING_PORT_POSTGRES}:5432"]`), and
3. writes the resolved `env`/`url` values to `.steckling/env`, which is loaded for `app.run`,
   the hooks, and `steck exec -- <cmd>`.

`<SERVICE_NAME>` is the upper-cased service key with non-alphanumerics replaced by `_`
(so `postgres` → `STECKLING_PORT_POSTGRES`).

## Injected identity vars

Alongside the service URLs, every branch env (`.steckling/env`, hooks, `app.run`, `exec`) gets:

| Var | Value |
| --- | --- |
| `STECKLING_BRANCH` | the branch name |
| `STECKLING_PROJECT` | the compose project name |
| `STECKLING_TICKET`* | the ticket ID, when one is parsed or set (`*`name configurable via `ticket.env`) |
| `STECKLING_TICKET_URL` | `ticket.url` rendered for the ticket, when both exist |

If an `env.extra` key collides with an injected var, **`env.extra` wins** (explicit config beats
engine values) and `steck up` prints a warning.

## Placeholders

| Placeholder | Where | Resolves to |
| --- | --- | --- |
| `{repo}` | `worktrees.dir` | repo folder name |
| `{port}` | `services.expose.*.url` | that service's allocated host port |
| `{app_port}` | `env.extra.*` values | the app's allocated host port |
| `{ticket}` | `ticket.url` | the parsed/recorded ticket ID |
