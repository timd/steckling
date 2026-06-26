# Contributing to Steckling

Thanks for your interest! Issues, bug reports, recipes, and PRs are all welcome.

## Project layout

```
engine/        the steckling CLI (TypeScript, runs on Bun)
  src/         cli.ts (dispatch) + one module per concern (config, naming, ports,
               compose, env, registry, worktree, hooks, lifecycle, mcp/)
  test/        e2e.sh + mcp-smoke.ts
demo/          a runnable example project (Postgres + a tiny Bun app)
docs/          documentation
packaging/     Homebrew formula template
```

## Dev setup

Requires [Bun](https://bun.sh), git, and Docker.

```sh
cd engine
bun install
bun run src/cli.ts doctor     # run any command during development
```

There's no build step in development — Bun runs the TypeScript directly.

## Before you push

```sh
cd engine
bun run typecheck             # tsc --noEmit, must be clean

# end-to-end against real Docker (needs a named branch, not detached HEAD):
git checkout -B my-branch
BUN=bun bash test/e2e.sh      # runs up → exec → list + the MCP smoke test
```

CI runs the same: typecheck, the dockerized e2e, and cross-compiled binaries
(`.github/workflows/ci.yml`).

## Conventions

- **TypeScript, strict.** Keep `bun run typecheck` clean; prefer small, single-purpose modules.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `chore:`…).
- **Keep the engine stack-agnostic.** It should only ever touch git, Docker, ports, and env
  vars — never assume a particular language or framework.
- **Verify against Docker, not just the type-checker.** Several past bugs only showed up at
  runtime; run `test/e2e.sh` for anything touching the lifecycle.

## Adding a recipe

Recipes live in `docs/recipes/`. Add a `<framework>.md` with a `steckling.yml` +
`compose.steckling.yml` and notes on anything framework-specific, then link it from
`docs/recipes/README.md` and the root README. See [nestjs.md](docs/recipes/nestjs.md) for the
shape.

## Releasing

Maintainers: see [RELEASING.md](RELEASING.md).

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to
uphold it.
