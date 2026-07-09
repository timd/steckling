# Troubleshooting

Start with `steck doctor` — it catches the most common environment problems. Then:

### `steck up` says "Not on a named git branch (detached HEAD)"

Steckling keys everything off the branch name, so you need a checked-out branch, not a detached
HEAD (common in CI). Check out a branch first: `git switch -c my-branch`.

### "docker compose up failed" / daemon not reachable

Docker isn't running, or the `docker compose` plugin is missing. Start Docker Desktop / the
engine and re-check with `steck doctor`. The first `up` for an image you don't have also pulls
it — that can take a minute.

### "required variable STECKLING_PORT_… is missing a value"

Your compose file references a `${STECKLING_PORT_<SERVICE>}` that doesn't match an `expose` entry.
The variable name is the **upper-cased service key** with non-alphanumerics replaced by `_`
(service `postgres` → `STECKLING_PORT_POSTGRES`). Make sure every published port uses a service you
listed under `services.expose`, and that you're going through `steckling` (not bare `docker compose`).

### My app still connects to the old database

Your app isn't reading `DATABASE_URL` from the environment — it's hardcoded, or your config loader
is force-overriding env from a file. Confirm with `steck exec -- printenv DATABASE_URL` (shows
the injected value) and make your app read that variable. See
[Adopting an existing project](adopting-an-existing-project.md#3-make-sure-the-app-reads-database_url-from-the-environment).

### The provision hook failed

`steck up` stops if `provision` exits non-zero, and does **not** mark the branch provisioned.
Fix the underlying command (run it via `steck exec -- <your migrate cmd>` to see the error
against the live DB), then `steck up` again. Force a re-run with `steck up --reprovision`.

### Port already allocated / collision

Ports are recorded per branch in `~/.steckling/registry.json` and checked free before use. If
something outside Steckling grabbed a recorded port while the branch was down, Steckling reallocates
and warns. If you think the registry is stale, `steck list` shows what it believes; `steck rm`
clears a single entry.

### `steck rm` refuses: "Refusing to rm the base branch"

`rm` guards the base branch (e.g. `main`) so you can't nuke it by accident. Pass `--force` if you
really mean it.

### A worktree folder is still there after `rm`/`prune`

By design — without `--purge`, `rm` and `prune` reclaim the heavy Docker resources but leave
your code (the folder shows as `unreg` in `steck list`). Pass `--purge` to also remove the
folder and delete the branch — it refuses dirty folders and unmerged branches with a warning,
so it can't eat uncommitted work (`--force` overrides on `rm`).

### My app ignores the injected port (EADDRINUSE on the old port)

Same root cause as the database case above: the app hardcodes its port instead of reading the
env var named in `app.port.env`. Read it with a fallback — e.g. `process.env.PORT ?? 4000` —
and each branch's app lands on its own port.

### `steck list` shows a worktree as `(missing)` or `unreg`

`(missing)` — the folder was deleted outside Steckling; `steck prune` reclaims its stack and
tidies git's bookkeeping. `unreg` — the opposite: a git worktree exists but has no steckling
stack (a plain `rm` ran, or it was created with raw `git worktree add`); `steck up` there
registers it, `steck rm <branch> --purge` removes it.

### Hot reload / file watching is slow

It shouldn't be — your app runs **natively on the host**, not in a container, so file watching is
native. If it's slow, that's your app's dev server, not Steckling.

### Two branches can't reach each other's services

That's intentional: each branch's stack is fully isolated (separate containers, networks, volumes).
Cross-branch communication isn't a supported pattern.

### Windows

There's no native Windows binary yet. Run Steckling under [WSL2](https://learn.microsoft.com/windows/wsl/)
with Docker Desktop's WSL integration enabled.

---

Still stuck? Open an issue with the output of `steck doctor` and `steck config`.
