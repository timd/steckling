# Deploying an agent to Railway

Steckling runs isolated stacks on **your** machine. `steck deploy` is the first
step off it: ship a branch's **agent** to [Railway](https://railway.com) as a
long-running (or scheduled) cloud service — declared once in `steckling.yml`,
built from a Dockerfile, and tracked in the same fleet registry.

> **Scope.** This is *Path 1* — a persistent agent you own and run. The ephemeral,
> fan-out sandbox path is separate (and not built yet). See
> [`docs/plan-remote-agents.md`](plan-remote-agents.md).

## Prerequisites

- The **Railway CLI** on your PATH, authenticated: `railway login`, or set
  `RAILWAY_TOKEN` (project) / `RAILWAY_API_TOKEN` (account) for CI. `steck doctor`
  shows a `railway` row confirming both.
- A **Dockerfile** that builds your agent (the demo's is `demo/Dockerfile`).

## Declare the agent

Add two optional blocks to `steckling.yml` (a config without them is unchanged):

```yaml
agent:
  kind: service            # service = always-on | scheduled = cron
  start: "bun run agent.ts" # the agent's start command
  build:
    dockerfile: ./Dockerfile
  # preDeploy: "bun run migrate.ts"   # optional: runs before the container starts

deploy:
  target: railway
  # project: my-agent       # optional; otherwise link once (below)
  needs: []                 # managed databases to provision (e.g. [postgres])
  env:
    ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"  # ${VARS} expand from your shell
```

## Preview before you ship

`--dry-run` prints the generated `railway.json` and the exact command sequence,
and executes nothing (secrets are masked):

```sh
steck deploy --dry-run
```

## First deploy

Bootstrap the Railway project + service once (Steckling deploys into a linked
service; it doesn't create one yet — see limitations):

```sh
railway init                 # create + link a project  (or: railway link, for an existing one)
railway add --service <name> # create the service to deploy into
steck deploy                 # generate railway.json, push variables, provision needs, railway up
steck logs                   # tail it
```

`steck deploy` writes a committable `railway.json` (build + deploy config as code:
`startCommand`, `cronSchedule`, `preDeployCommand`, Dockerfile path), sets your
`deploy.env` variables, provisions any `deploy.needs` databases, and runs
`railway up`.

## Operate

```sh
steck deploy --status   # branch, kind, project, last deploy
steck logs -n 100       # recent logs   (--build for build logs)
steck destroy           # tear down the Railway deployment (local stack untouched)
```

## Scheduled agents

Set `kind: scheduled` and a 5-field cron (`schedule`). Steckling writes it to
`railway.json` as `cronSchedule`; the service must **exit** when its task is done,
and Railway's floor is **every 5 minutes** (UTC). `steck deploy` warns on
sub-5-minute schedules.

```yaml
agent:
  kind: scheduled
  start: "bun run digest.ts"
  schedule: "0 9 * * *"   # 09:00 UTC daily
  build: { dockerfile: ./Dockerfile }
```

## Managed dependencies

`deploy.needs: [postgres]` provisions a managed Postgres via `railway add`. Wire
its URL into your agent with a Railway reference variable under `deploy.env` —
`steck deploy` prints the reference to use, e.g.:

```yaml
deploy:
  needs: [postgres]
  env:
    DATABASE_URL: "${{Postgres.DATABASE_URL}}"
```

## Known limitations (roadmap)

- **Service bootstrap is manual** — `steck deploy` deploys into an existing linked
  service; run `railway add --service <name>` once first. Auto-ensuring the
  service is a fast-follow (validated live: a fresh project has no service, and
  `railway variable` operates on a service).
- **`deploy --status` shows the branch as the project name** when `deploy.project`
  isn't set, rather than the actual linked Railway project.
- **Deploy-only configs** aren't supported yet — a manifest still needs the local
  `services`/`app` blocks. Making those optional is a fast-follow.
- **Managed-dep wiring** is a printed hint, not automatic — you add the reference
  variable yourself.
- **Per-branch Railway environments** (mapping branches → Railway PR/ephemeral
  environments) are designed-for but not built.
- The Railway CLI moves fast; every `railway` invocation is isolated in
  `engine/src/backends/railway.ts` if a command surface changes.
