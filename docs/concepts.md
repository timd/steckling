# Concepts

Steckling does three things, and deliberately nothing else. Understanding these three is
understanding the whole tool.

## 1. A folder per branch (git worktree)

A [git worktree](https://git-scm.com/docs/git-worktree) is a second working directory attached
to the same repository. Steckling uses one per branch:

```
myapp/                       ← your primary checkout (e.g. main)
../myapp-trees/feature-a/    ← worktree for branch feature-a
../myapp-trees/feature-b/    ← worktree for branch feature-b
```

They share git history but have independent working trees — so `feature-a` and `feature-b` are
checked out *at the same time*, in different folders. `steck new <branch>` creates one;
`worktrees.dir` in `steckling.yml` controls where they live (default `../{repo}-trees`).

You don't have to use worktrees at all — `steck up` works in your primary checkout too. Reach
for `new` when you want two branches live simultaneously.

## 2. Private services per branch (Docker Compose project)

For each branch, Steckling runs your services as an isolated **Docker Compose project**, named
`steckling_<slug>_<hash>` (derived from the branch name). Compose namespaces everything by project,
so each branch gets its own containers, its own named volumes, and its own network. Branch A's
Postgres and Branch B's Postgres are different databases with different data that happen to run
on the same Docker engine.

Each service you `expose` is published on a **free host port** Steckling picks (preferring a stable,
branch-hash-derived block, then scanning for the next free one). Ports are recorded in
`~/.steckling/registry.json` so they stay the same for a branch across restarts. Steckling injects
the chosen port into your compose file via `STECKLING_PORT_<SERVICE>`, which is why your compose
file writes `ports: ["${STECKLING_PORT_POSTGRES}:5432"]`.

## 3. Env injection (how your app finds its services)

This is the key to being stack-agnostic. Steckling **does not run your app for you in any special
way** — it runs your normal dev command (`app.run`) with a set of environment variables that point
at *this branch's* services:

- For each exposed service, it resolves the `url` template (`{port}` → the allocated host port)
  and sets it on the env var you named (`DATABASE_URL`, `REDIS_URL`, …).
- It writes them to a gitignored `.steckling/env` file in the worktree.
- It runs `app.run`, the `provision` hook, and `steck exec -- <cmd>` with that env loaded.

Your app reads `DATABASE_URL` from the environment (as it already does) and connects to the right
database. No code knows Steckling exists.

> Most config loaders (dotenv, `@nestjs/config`, Rails, …) don't override an environment variable
> that's already set. So even if you have a committed `.env` pointing at an old local database,
> the branch's injected `DATABASE_URL` wins automatically.

## Provisioning

The `provision` hook (e.g. `migrate && seed`) runs once per stack: on the first `steck up`
after the hook exists, after which a marker (`.steckling/.provisioned`) is recorded and
subsequent `up`s skip it. A hook added to an already-running stack therefore still runs on the
next `up`; a failing hook exits non-zero and leaves the marker unwritten. Force a re-run with
`steck up --reprovision`.

## Ticket-aware branches (optional)

Steckling keys everything off the branch name — and if your tracker generates branch names
(most can), the branch name already contains the ticket. Give Steckling the pattern once
(`ticket.pattern` in `steckling.yml`) and every worktree knows which ticket it serves: visible in
`steck list`/`status`, injected into hooks and your app as `$STECKLING_TICKET`, readable by
agents over MCP. Steckling never calls the tracker's API; transitions belong in your hook strings
or your agent, where judgment lives. See the
[ticket-trackers recipe](recipes/ticket-trackers.md).

## The registry

`~/.steckling/registry.json` is the single source of truth: every worktree, its branch, its host
ports, its path. It's what makes ports stable, what `steck list`/`status` read, and what the
MCP server exposes as `steckling://registry`. Status is reconciled against Docker on read, so a
crash or a manual `docker rm` can't desync it.

## What Steckling is *not*

- **Not a process manager.** It runs your one `app.run` command in the foreground; it doesn't
  supervise multiple processes. Run workers/extra processes via a second terminal or `steck exec`.
- **Not a container for your app.** Your app runs natively on the host — native file watching,
  native debugger, native toolchain. Only the *services* are in Docker.
- **Not framework-aware.** It only manipulates git, Docker, ports, and env vars.

→ Next: [Quickstart](quickstart.md) or [Adopting an existing project](adopting-an-existing-project.md).
