# Releasing Steckling

Prerequisite (one-time): the repo lives on GitHub and `timd` has been substituted for the
real owner in `install.sh` and `packaging/homebrew/steckling.rb`.

## Cut a release

1. Bump the version in `engine/package.json` (this is what `steck --version` reports) and
   the `version` in `packaging/homebrew/steckling.rb`. Commit.
2. Tag and push:
   ```sh
   git tag v0.1.0
   git push origin main --tags
   ```
3. The **Release** workflow (`.github/workflows/release.yml`) cross-compiles
   `steck-linux-x64`, `steck-darwin-arm64`, `steck-darwin-x64`, generates
   `checksums.txt`, and attaches them to a GitHub Release for the tag.

## Make it installable (one-time, gated on the repo being public)

The install script and Homebrew both download release assets **anonymously**, so they only work
once `timd/steckling` (and its releases) are **public**:

```sh
gh repo edit timd/steckling --visibility public --accept-visibility-change-consequences
```

### Publish the Homebrew tap (first time)

The canonical formula lives at `packaging/homebrew/steckling.rb` and is already filled in for the
current release. Create the public tap repo and drop the formula in:

```sh
gh repo create timd/homebrew-steckling --public -d "Homebrew tap for Steckling"
git clone git@github.com:timd/homebrew-steckling.git /tmp/homebrew-steckling
mkdir -p /tmp/homebrew-steckling/Formula
cp packaging/homebrew/steckling.rb /tmp/homebrew-steckling/Formula/steckling.rb
git -C /tmp/homebrew-steckling add -A && git -C /tmp/homebrew-steckling commit -m "steckling 0.1.0"
git -C /tmp/homebrew-steckling push
```

Then `brew install timd/steckling/steckling` works for everyone.

### On every subsequent release

Bump `version` + the three `sha256` values in `packaging/homebrew/steckling.rb` (from the release's
`checksums.txt`), copy it into the tap's `Formula/steckling.rb`, and commit. Users get it via
`brew upgrade steckling`.

## How users install

- **Script:** `curl -fsSL https://raw.githubusercontent.com/timd/steckling/main/install.sh | sh`
  (downloads the right binary to `~/.local/bin`).
- **Homebrew:** `brew install timd/steckling/steckling`.
- **Direct:** download the binary for your platform from the Releases page, `chmod +x`, move
  onto your PATH.

All three need only `git` + `docker` at runtime — the Bun runtime is baked into the binary.

## Versioning note

The version is currently hand-maintained in `engine/package.json`. A future improvement is to
inject the git tag into the build (`--define`) so the tag is the single source of truth.
