# ADR 0001 — A remote agent-deploy target (Railway)

**Status:** accepted · **Date:** 2026-07-01 · **Scope:** Path 1 (long-running / scheduled agents)

## Context

Steckling is a local dev-loop tool: a git worktree + an isolated Docker service
stack + a native host app, per branch. We want an easy way to **author an agent
and run it somewhere that isn't the developer's machine** — for long-running or
scheduled workloads (a bot, a webhook responder, a nightly job).

Anthropic's Managed Agents already hosts agents, but building this on general
cloud infra (Railway) is a deliberate choice — we own the runtime, keep it
portable, and it makes a better public/portfolio artifact.

## Decision

Add a **remote deploy target** as an *additive* capability, not a relocation of
the local flow. The local model is untouched; `steck deploy` is a new verb.

1. **Railway, via its CLI.** Shell out to the `railway` CLI (through the existing
   `sh.ts`), exactly as the engine already shells out to `docker compose` and
   `git`. Auth is headless via `RAILWAY_TOKEN` / `RAILWAY_API_TOKEN`. Every
   `railway` subcommand is isolated in `engine/src/backends/railway.ts` so the
   fast-moving CLI is a one-file blast radius.
2. **Config-as-code, generated.** The engine translates the `agent` block of
   `steckling.yml` into Railway's `railway.json` (`startCommand`, `cronSchedule`,
   `preDeployCommand`, Dockerfile builder). Steckling keeps its "declare once,
   engine computes the rest" contract.
3. **Additive config + registry.** Optional `agent`/`deploy` blocks (a config
   without them is byte-for-byte unchanged in behaviour); an optional `railway`
   sub-record on the registry `WorktreeRecord` — no discriminated-union migration
   of existing records, and local + remote show up in one fleet view.
4. **Explicit remote pre-deploy.** `agent.preDeploy` is a *separate* field, not a
   reuse of `hooks.provision` — the local provision hook targets the *local* stack
   (e.g. migrates the local Postgres), which a standalone remote agent doesn't
   have. Auto-mapping it would try to migrate a database that isn't there.
5. **`--dry-run` first.** `steck deploy --dry-run` prints the `railway.json` and
   the exact command plan (secrets masked) and executes nothing, so the path is
   fully inspectable without a live account.

## Alternatives considered

- **Anthropic Managed Agents.** Least glue (hosted loop + container, cron
  deployments, forkable sessions), but Anthropic-coupled and not the artifact we
  want to build. Kept as a documented alternative in the plan.
- **Railway GraphQL API directly.** More control, no CLI dependency, but more code
  and auth surface. The CLI is the idiomatic match for how the engine already
  works; revisit if the CLI proves too limiting.
- **A hard `target: "local" | "railway"` discriminant on every record.** Rejected
  in favour of an optional `railway` sub-record — same fleet-view benefit, zero
  migration of existing local records.

## Consequences

- The remote app is a **container image** (Dockerfile), not a native host process
  — this crosses the local "app runs natively" decision, but only for the remote
  target, which is inherent to going remote.
- `compose.steckling.yml` does **not** port; remote dependencies are managed
  Railway services named explicitly via `deploy.needs`.
- We depend on the Railway CLI's command surface (isolated as above).

## Deferred / follow-ups

- **Auto-ensure a Railway service** — a fresh project has none, and `railway
  variable` needs one; today it's a one-time `railway add --service` bootstrap
  (found during live testing). Also: record the real linked project name in the
  registry (status currently falls back to the branch name).
- **Deploy-only configs** — make `services`/`app` optional so an agent needs no
  local stack.
- **Managed-dep wiring** — auto-emit the `${{Service.VAR}}` reference instead of
  printing a hint.
- **Per-branch Railway environments** via `environments.[name]` overrides.
- **Path 2** — ephemeral, forkable Sandbox fan-out (separate ADR).
- **CI smoke test** against a real Railway account.
