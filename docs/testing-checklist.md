# Manual testing checklist

A CRUD-lifecycle regression script for `steck`, distilled from the 2026-07 QA sessions.
Run it in a **fresh throwaway repo** before a release. Automated coverage of the same
ground: `engine/test/e2e.sh` (run from `engine/`, needs a named branch).

Setup: a repo with `git init -b main` (no commit yet), a `package.json` with a `dev`
script, a `server.js` that reads `process.env.PORT` / `DATABASE_URL`, a gitignored
`.env.local`, and Docker running.

## Create

| Step | Expect |
| --- | --- |
| `steck init` before any commit | No "not on a named branch" warning (unborn branch is fine). Wizard: postgres preset; run command *detected from package.json*; `.env.local` offered for copyOnCreate. Writes `steckling.yml`, `compose.steckling.yml`, `.gitignore` entry. |
| `steck init` again | Refuses — already configured. |
| `steck config` / `steck doctor` | Valid resolved config / all green. |
| `steck new feat/a` before first commit | Clean error: "Base 'main' has no commits to branch from." |
| commit, then `steck new feat/a` | Worktree created, `.env.local` copied, ports allocated. Repeat → "already exists". |
| `steck new feat/b --up --no-run` | Worktree **and** services up; app not run (`--no-run` = skip the app, services still start). |

## Read

| Step | Expect |
| --- | --- |
| `steck list` | Both branches, live status, distinct ports, no stale rows. |
| `steck status feat/b` | Project, status, ports, env path, last-used. |
| `docker rm -f` a branch's container, `steck list` | Status reconciles to `down` — registry never lies. |
| plain-`rm`'d worktree still on disk | Shows dimmed as `unreg` with legend. |

## Use & update

| Step | Expect |
| --- | --- |
| `steck exec -- env` before first `up` | "No .steckling/env found". |
| `steck up` in feat/a | Ports from `new` reused; env written; app runs on injected `PORT`. |
| `steck up` in feat/b simultaneously | Both apps run — different ports, different DBs, no EADDRINUSE. |
| `steck exec -- sh -c 'echo "$DATABASE_URL"'` | Branch's URL (note: single quotes — expansion must happen in the child). |
| `.env`/`.env.local` in the worktree | Its vars must **not** appear in `steck exec` env (Bun dotenv autoload is disabled at build time). |
| create table in a; select in b | b errors "relation does not exist" — isolation. |
| `down` then `up` | Same ports, data survived. |
| add `hooks.provision` to an already-upped stack | Runs on next `up` (marker = "hook ran", not "first boot"); `--reprovision` reruns; failing hook exits non-zero. |
| empty the compose file, `steck down` | Still stops the running containers (label-based). `up` then skips Docker, injects `PORT` only. |
| `git checkout --detach`, any command | Clear "not on a named git branch" error. |

## Delete

| Step | Expect |
| --- | --- |
| `steck down` twice | "Stopped N…" then "No running containers — nothing to stop." |
| `steck rm feat/b --yes` | Containers + volumes + registry gone; folder + branch kept; hint printed; shows as `unreg` in list. |
| dirty folder + `rm --purge` | Folder **and** branch kept, override hints printed. |
| clean + unmerged commit + `rm --purge` | Folder removed (empty `feat/` parents swept), branch kept ("not fully merged"). Works even with no registry entry. |
| merge branches, `steck prune --purge --yes` | Merged candidates fully reclaimed: containers, volumes, folders, branches, registry. Branches with no unique commits count as merged. |
| `steck rm main --yes` | Refused (base branch) without `--force`. |
| stale entry from a deleted repo | `steck prune` offers it as "repo folder missing"; other repos' records otherwise untouched. |
| final audit | `steck list` empty; no `steckling_*` containers/volumes; `git worktree list` clean; only expected branches. |

## Agent surface

| Step | Expect |
| --- | --- |
| `steck deploy --dry-run` without `agent` block | Clear config error, nothing executed. |
| `cd engine && BUN=bun bash test/e2e.sh` (named branch) | up → exec (seeded rows) → list → MCP smoke → `E2E PASSED`, self-cleans. |

## Known environment gotchas

- Installing a rebuilt binary: `rm` the old one before `cp` — macOS SIGKILLs a binary
  overwritten in place (signature/inode cache).
- Apps must read the injected env vars (`PORT`, `DATABASE_URL`); a hardcoded port is the
  #1 "it collided anyway" cause.
