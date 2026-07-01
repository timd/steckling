# Steckling — Remote Agents (Path 1: long-running / scheduled agent → Railway)

**Status:** plan / pre-build · **Scope:** Path 1 only (Path 2, ephemeral fan-out sandboxes, is deferred) · **Date:** 2026-07-01

## 1. Goal

Let a branch **deploy its agent to Railway as a long-running (or scheduled) cloud service**, declared once in `steckling.yml` and driven by `steck deploy` — so an agent you author locally runs somewhere that isn't your machine, tracked in the same fleet registry and drivable from Claude via MCP.

This is an **additive backend/target**, not a relocation of the existing local flow. Steckling's local model (worktree + Docker services + native host app) is untouched; `deploy` is a new verb that reuses the two portable assets — the declarative config contract and the registry/MCP fleet spine — and delegates execution to Railway.

**Non-goal for this increment:** the ephemeral, forkable Sandbox fan-out (Path 2). Designed-for, not built here.

## 2. Why this shape (grounded in Railway's real surface)

Confirmed against Railway docs:

- **Config-as-code (`railway.json`)** expresses everything Path 1 needs, per-deployment, overriding the dashboard:
  - `deploy.startCommand` — the agent loop
  - `deploy.cronSchedule` — scheduled agents are **scriptable**, not dashboard-only (UTC, ≥5-min interval, process must exit)
  - `deploy.preDeployCommand` (array) — maps directly to Steckling's `hooks.provision` (migrate/seed)
  - `build.builder` (`DOCKERFILE` | `RAILPACK`), `build.dockerfilePath`, `deploy.healthcheckPath`, `deploy.restartPolicyType`
  - per-environment overrides via `environments.[name]`, incl. a native `pr` ephemeral-env block (relevant to the deferred per-branch-env fast-follow)
- **CLI** is headless-scriptable: `RAILWAY_TOKEN` (project) / `RAILWAY_API_TOKEN` (account) env instead of interactive `railway login`.
- Relevant CLI verbs: `railway init` / `link` / `status`, `railway up` (builds from a Dockerfile when present), `railway variable set`, `railway add --database postgres`, `railway logs`, `railway down`, `railway environment new`.

**Consequence:** Steckling keeps its "declare once in `steckling.yml`, engine computes the rest" contract — it **generates `railway.json`** from the manifest and **shells out to the `railway` CLI**, exactly as it already shells out to `docker compose` and `git`.

## 3. Decisions locked

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Transport | Shell out to the `railway` CLI via `sh.ts` | Idiomatic — mirrors docker/git; smallest bolt-on; no GraphQL client to maintain |
| 2 | Auth | Headless `RAILWAY_TOKEN` / `RAILWAY_API_TOKEN` env | CI-friendly; no interactive login in the engine path |
| 3 | Deploy config | Engine **generates `railway.json`** in the worktree from `agent:` | Preserves the declarative contract; reproducible; committable |
| 4 | Secrets/env | `railway variable set` from `services.expose` + `deploy.env` | `railway.json` carries build/deploy settings, not secrets |
| 5 | Managed deps | `deploy.needs: [postgres]` → `railway add --database postgres` | Reuse the exposed-service list; managed infra, private-networked |
| 6 | State model | Registry gains `target: "local" \| "railway"` | One fleet view; local and remote side by side in `steck list` |
| 7 | App form | App becomes a **container image** (Dockerfile) | Inherent to going remote; crosses local decision #2 (native-on-host) by design, only for the remote target |

## 4. Config contract (`steckling.yml` additions — backward-compatible)

Both blocks are **optional**; existing configs remain valid and `deploy` is inert without them.

```yaml
agent:
  kind: service              # service = always-on | scheduled = cron
  build:
    dockerfile: ./Dockerfile # → railway.json build.dockerfilePath + builder: DOCKERFILE
  start: "bun run agent.ts"  # → railway.json deploy.startCommand
  schedule: "0 9 * * *"      # scheduled kind only → deploy.cronSchedule (UTC, ≥5 min)

deploy:
  target: railway
  project: my-agent          # linked Railway project (created on first deploy if absent)
  needs: [postgres]          # exposed deps → managed Railway services
  env:                       # extra vars pushed to Railway variables
    ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"
```

`hooks.provision` is reused as `railway.json` `deploy.preDeployCommand` — no new hook needed.

## 5. Deploy flow (`steck deploy` happy path)

1. Pre-flight (`doctor`-style): `railway` CLI present + authenticated (token env or prior `login`); config has an `agent`/`deploy` block; Dockerfile exists.
2. Resolve/attach the Railway project: registry has a linked project for this branch → use it; else `railway init` (or link to `deploy.project`) and record it.
3. `railway add --database <dep>` for each `deploy.needs` not already present.
4. Generate `railway.json` in the worktree from `agent:` (`startCommand`, `cronSchedule`, `dockerfilePath`, `preDeployCommand` ← `hooks.provision`, healthcheck).
5. Push variables: resolved `services.expose` URLs + `deploy.env` via `railway variable set` (reference managed-dep vars where available).
6. `railway up` (builds the Dockerfile, runs `preDeployCommand`, starts the service — or registers the cron schedule).
7. `railway domain` if the agent serves HTTP; record project/env/service/domain/schedule in the registry.
8. Print status + the one command to tail it (`steck logs`).

## 6. Module / CLI plan

```
engine/src/
  config.ts            # + optional agent/deploy zod blocks (existing configs stay valid)
  backends/railway.ts  # NEW: deploy/status/logs/destroy + writeRailwayJson; all via sh.ts
  deploy.ts            # NEW: orchestrator, dispatches on deploy.target (keeps lifecycle.ts local-only)
  registry.ts          # + target discriminant + railway record fields
  cli.ts               # + deploy / logs / destroy verbs (+ --status)
  doctor.ts            # + railway CLI + auth check
demo/agent/            # NEW: tiny real Claude agent (@anthropic-ai/sdk, claude-opus-4-8) + Dockerfile + wired steckling.yml
docs/deploy-railway.md # NEW: the guide
docs/adr/0001-remote-agent-target.md # NEW: decision record
```

### Registry record (railway target)

```jsonc
{
  "target": "railway",
  "branch": "feat-a",
  "railway": { "project": "…", "environment": "…", "service": "…", "domain": "…", "schedule": "0 9 * * *" },
  "createdAt": "…", "lastUsedAt": "…"
}
```

### CLI surface (additions)

| Command | Behaviour |
|---|---|
| `steck deploy [--status]` | Build + ship this branch's agent to Railway (or print remote status) |
| `steck logs [-n N] [--build]` | Tail the deployed agent's logs (`railway logs`) |
| `steck destroy [--yes]` | Tear down the Railway service/deployment (`railway down`), keep local intact |

## 7. Demo agent (the runnable proof + writeup artifact)

A tiny, real agent under `demo/agent/` proving the whole loop end to end, using `@anthropic-ai/sdk` and `claude-opus-4-8`. Flavour TBD (headline candidate: a **scheduled repo-digest agent** — cron, summarizes recent commits/issues via Claude, posts to a webhook — which exercises `kind: scheduled` + a real Claude call + an outbound action). Scaffolding option: start with a trivial always-on **heartbeat** agent to prove the pipeline, then grow it into the digest.

## 8. Deferred (designed-for, not built in this increment)

- **Per-branch Railway environments** — map branches → Railway PR/ephemeral environments via `environments.[name]` overrides.
- **Auto-deploy on `steck new`** — `--deploy` flag.
- **Data seeding / volumes** on the remote side.
- **CI smoke test** against a real Railway account.
- **Path 2** — ephemeral, forkable Sandbox fan-out (separate plan).

## 9. Risks / open questions

- **No live deploy in this build session.** A real `railway up` needs the owner's auth and creates billable resources. Mitigation: build + keep `bun run typecheck` clean, make railway calls thin/mockable, hand over exact verification commands. (Optional: a live MCP-provisioned demo on the owner's account, only on explicit request.)
- **`railway.json` is per-deployment, not persisted to dashboard settings** — good (committed config wins each deploy), but means variables/managed-deps are managed separately (steps 3 & 5), not in the JSON.
- **First-deploy project linking** is slightly stateful (`railway init`/`link`) — needs a clear one-time bootstrap in `steck deploy`.
- **Cron constraints** — ≥5-min interval, UTC, must-exit; validate `agent.schedule` and warn on sub-5-min.
- **`compose.steckling.yml` doesn't port** — remote deps are managed Railway services, not the local compose stack. `deploy.needs` names them explicitly rather than translating compose.

## 10. Verification

- `cd engine && bun run typecheck` stays clean.
- Unit-level: `writeRailwayJson` produces the expected JSON from a sample manifest; `deploy` dispatches on target; registry round-trips a railway record.
- Manual (owner, against real Railway): documented command sequence in `docs/deploy-railway.md`.
