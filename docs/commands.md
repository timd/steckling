# Command reference

Run `steck <command>`. Global flags: `-h/--help`, `-v/--version`.

Most commands act on the **current branch** — resolved from the worktree you're in (the directory
containing `steckling.yml`, searched upward). `new`, and the `[branch]` argument on some commands,
let you act on another branch by name.

---

### `steck init [--yes]`

Set up the current repo interactively — the wizard writes everything `steck up` needs, so you
never have to hand-edit YAML to get started:

- **`steckling.yml`** — built from your answers (services, app command, app port, provision
  hook, base branch, `copyOnCreate` files). Detected values (run command from `package.json`/
  `Cargo.toml`/`go.mod`/…, `.env*` files, base branch) are offered as defaults.
- **`compose.steckling.yml`** — generated from service presets (Postgres, MySQL, Redis,
  MongoDB, RabbitMQ), each pre-wired with the right `STECKLING_PORT_*` variable, a healthcheck,
  and a data volume. If the repo already has a compose file you can point at it instead — the
  wizard reads its services and prints the `ports:` edits it needs.
- **`.gitignore`** — gets `.steckling/` appended if missing.

The generated config is validated before `init` exits. Refuses to overwrite an existing
`steckling.yml`.

- `--yes`/`-y` — skip the wizard and write a default setup (Postgres + detected run command).
  Required when running non-interactively.

---

### `steck new <branch> [base]`

Create a git worktree for a new branch and allocate its service ports (recorded in the registry).
If a `ticket` block is configured, the ticket ID is parsed from the branch name and recorded too;
then the `postCreate` hook runs in the new worktree with the identity env
(`STECKLING_BRANCH`/`STECKLING_TICKET`, …) — a failing hook warns but keeps the worktree.

- `base` — branch to fork from (default: `worktrees.base`, usually `main`). Uses `origin/<base>`
  if it exists, else the local `<base>`.
- The worktree is created at `worktrees.dir/<branch>` (default `../<repo>-trees/<branch>`).
- Files listed in `worktrees.copyOnCreate` are copied in (gitignored local files a fresh worktree
  lacks, e.g. `.env.local`).

Flags:

- `--up` — bring services up immediately after creating.
- `--no-run` — with `--up`, bring services up but don't run the app.
- `--ticket <id>` — record a ticket ID explicitly (overrides parsing the branch name).

```sh
steck new feature/PLA-123
steck new hotfix/login main --up --no-run
steck new spike/cleanup --ticket ENG-456
```

---

### `steck up [--no-run] [--reprovision]`

Bring up the current branch's stack and run the app.

1. Resolve/allocate host ports (reusing the registry's record so they're stable).
2. `docker compose up --wait` (waits for healthchecks).
3. Write `.steckling/env`.
4. Run the `provision` hook **if it hasn't run for this stack yet** (tracked by
   `.steckling/.provisioned`, written after the first successful run — so a hook added later
   still runs on the next `up`).
5. Run `app.run` in the foreground.

Flags:

- `--no-run` — do everything except step 5 (leave the stack up, don't start the app).
- `--reprovision` — run the `provision` hook again even if already provisioned.

---

### `steck tree`

A full-terminal **cockpit** for the current branch, delegated to
[mprocs](https://github.com/pvolok/mprocs) (install: `brew install mprocs` — `steck doctor`
checks for it):

- First does everything `steck up --no-run` does (ports, services up + healthy, env written,
  provision-once).
- Then opens a TUI with one pane per compose **service** (live `docker compose logs -f`) and an
  **app** pane running `app.run` with the branch env injected — so mprocs' `s`/`x`/`r` keys
  genuinely start/stop/restart your app. `z` zooms a pane, `q` quits.
- Quitting leaves the services running (`steck down` stops them). The services themselves stay
  Docker-managed throughout — the TUI is a viewport plus an app restarter, not a process manager.

The config is generated fresh on every run at `.steckling/mprocs.yaml` from your
`steckling.yml` — nothing to maintain by hand. Two branches side by side = `steck tree` in two
terminals.

---

### `steck down`

Stop the current branch's containers. **Keeps volumes and data** — frees memory. Resume with
`steck up`. Stops by compose-project label (what's actually running), so it works even if the
compose file has been edited since the stack started.

---

### `steck exec -- <command> [args…]`

Run any command with the current branch's `.steckling/env` loaded.

```sh
steck exec -- sh -c 'psql "$DATABASE_URL"'
steck exec -- npm run migration:revert
```

Note the single quotes: `$DATABASE_URL` must reach the child shell unexpanded — your own shell
doesn't have the branch env, the command steck runs does.

Requires `steck up` to have been run at least once (so `.steckling/env` exists).

---

### `steck list`

Table of every registered worktree: branch, live status (`up`/`stopped`/`down`), host ports, and
path — plus a TICKET column once any worktree carries a ticket. `(missing)` flags a worktree whose
folder is gone. Status is reconciled against Docker.

---

### `steck status [branch]`

Detail for one worktree — branch, compose project, status, ticket (with its rendered `ticket.url`
link, when configured), ports, the `.steckling/env` path, and last-used time. Defaults to the
current branch; pass a branch name to inspect another.

---

### `steck rm [branch] [--yes] [--force] [--purge]`

Destroy a branch's stack: removes its containers, **named volumes (data loss)**, and registry
entry. Leaves the worktree folder and git branch intact unless `--purge`. The `teardown` hook
(if configured) runs in the worktree first, with `.steckling/env` + the identity vars loaded —
a non-zero exit **aborts the rm** so a cleanup step can't be silently lost.

- `--yes`/`-y` — skip the confirmation prompt (required when non-interactive).
- `--force` — allow removing the base branch's stack (refused by default), proceed past a
  failing `teardown` hook, and with `--purge` also override the dirty-worktree and
  unmerged-branch safety checks.
- `--purge` — additionally remove the worktree folder and delete the git branch. Safety: a
  folder with uncommitted changes is kept (git refuses), and an unmerged branch is kept —
  each with a warning telling you how to override.
- `[branch]` — target another branch without checking it out (defaults to current).

```sh
steck rm feature/PLA-123 --yes --purge
```

---

### `steck prune [--yes] [--purge]`

Find worktrees whose branch is **merged into base**, **deleted**, or whose **folder is missing**,
and reclaim their stacks (containers + volumes + registry entry). Lists candidates first; pass
`--yes` to skip the prompt.

The registry is global across repos; prune only judges branches of the repo you run it in.
Records from *other* repos are reclaimed only when that repo's folder no longer exists
("repo folder missing").

With `--purge`, also removes each candidate's worktree folder and deletes its branch — the
post-merge one-liner that leaves nothing behind. Same safety rules as `rm --purge`: dirty
folders and branches git can't confirm as merged are kept with a warning.

The `teardown` hook runs per branch before its stack is destroyed. Unlike `rm`, a failing hook
only **skips that branch** (left un-pruned, with a warning) — one broken hook doesn't wedge the
whole batch.

---

### `steck deploy [--dry-run] [--status]`

Ship the current branch's **agent** to Railway as a long-running or scheduled service. Requires
`agent`/`deploy` blocks in `steckling.yml` and the `railway` CLI, authenticated — see
[Deploy to Railway](deploy-railway.md).

1. Generate `railway.json` from the `agent` block (build + start command + optional cron).
2. Provision `deploy.needs` databases; push `deploy.env` variables (secrets via `--stdin`).
3. `railway up` to build the Dockerfile and deploy.

Flags:

- `--dry-run` — print the generated `railway.json` and the command plan; execute nothing.
- `--status` — show the recorded deployment (project, kind, last deploy) instead of deploying.

---

### `steck logs [-n N] [--build]`

Tail the deployed agent's logs (`railway logs`). `-n N` limits to the last N lines; `--build`
shows build logs instead of runtime logs.

---

### `steck destroy [--yes]`

Tear down the current branch's Railway deployment (`railway down`). The **local** stack and git
worktree are left untouched. `--yes`/`-y` skips the confirmation prompt (required when
non-interactive).

---

### `steck mcp`

Start the stdio [MCP](mcp.md) server — exposes the fleet to agents as tools + the
`steckling://registry` resource. Usually launched by your MCP client, not by hand.

---

### `steck config`

Validate `steckling.yml` and print the fully-resolved config (with defaults filled in). Useful for
debugging the config or seeing what Steckling will use.

---

### `steck doctor`

Pre-flight check: bun, git, the Docker daemon, `docker compose`, the `railway` CLI (a warning if
absent — it's only needed for `steck deploy`), and whether a valid `steckling.yml` is present.
Exits non-zero if a hard requirement fails.
