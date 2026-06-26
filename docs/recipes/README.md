# Recipes

Steckling is stack-agnostic — the engine only deals with Docker, ports, and env vars. A "recipe" is
just a `steckling.yml` + `compose.steckling.yml` wired for a particular framework, with notes on the
one or two things specific to it.

The contract is always the same:

1. Your `compose.steckling.yml` publishes host ports via `${STECKLING_PORT_<SERVICE>}`.
2. Your `steckling.yml` maps each exposed service to the **env var your app already reads**.
3. `app.run` is your normal dev command; `hooks.provision` is your normal migrate/seed.

## Available recipes

- [Node / NestJS](nestjs.md)
- [Ruby on Rails](rails.md)
- [Django](django.md)
- [Go](go.md)

Using a stack that's not here? Any of the above transfers directly — swap `app.run` and the
provision hook for your framework's equivalents. PRs adding recipes are welcome.
