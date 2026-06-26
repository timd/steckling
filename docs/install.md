# Installing Steckling

## Requirements

- **git**
- **Docker** — Docker Desktop or Docker Engine, with the `docker compose` plugin, running.
- macOS or Linux. On Windows, run under [WSL2](https://learn.microsoft.com/windows/wsl/).

The CLI ships as a single self-contained binary (the Bun runtime is baked in), so there's nothing
else to install.

## Install script

```sh
curl -fsSL https://raw.githubusercontent.com/timd/steckling/main/install.sh | sh
```

Downloads the right binary for your OS/architecture to `~/.local/bin/steck`. Overrides:

| Variable | Default | Purpose |
| --- | --- | --- |
| `STECKLING_BIN_DIR` | `~/.local/bin` | install location |
| `STECKLING_VERSION` | `latest` | a specific release tag, e.g. `v0.1.0` |

If `~/.local/bin` isn't on your `PATH`, the script tells you — add it to your shell profile.

## Homebrew

```sh
brew install timd/steckling/steckling
```

(Taps `timd/homebrew-steckling` on first use.) Upgrade with `brew upgrade steckling`.

## From source (Bun)

For development, or to run the latest `main`:

```sh
git clone git@github.com:timd/steckling.git
cd steckling/engine
bun install
bun run src/cli.ts doctor          # run any command this way
```

To get a real `steck` command on your PATH from a source checkout, compile it:

```sh
bun build src/cli.ts --compile --outfile ~/.local/bin/steck
```

## Manual binary

Download the binary for your platform from the [Releases](https://github.com/timd/steckling/releases)
page, then:

```sh
chmod +x steck-darwin-arm64
mv steck-darwin-arm64 ~/.local/bin/steck
```

Verify checksums against the release's `checksums.txt`.

## Verify

```sh
steck --version
steck doctor      # checks git, the Docker daemon, and docker compose
```

## Uninstall

```sh
rm "$(command -v steck)"       # the binary
rm -rf ~/.steckling            # the registry (only if you've torn down all worktrees)
```
