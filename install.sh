#!/usr/bin/env sh
#
# Install the Steckling CLI from a GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/timd/steckling/main/install.sh | sh
#
# Env overrides:
#   STECKLING_REPO     owner/repo to download from   (default: timd/steckling)
#   STECKLING_VERSION  release tag, or "latest"      (default: latest)
#   STECKLING_BIN_DIR  install directory             (default: ~/.local/bin)
set -eu

REPO="${STECKLING_REPO:-timd/steckling}"
VERSION="${STECKLING_VERSION:-latest}"
BIN_DIR="${STECKLING_BIN_DIR:-$HOME/.local/bin}"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) echo "Unsupported OS: $os (on Windows, run under WSL2)." >&2; exit 1 ;;
esac
case "$arch" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

if [ "$os" = "linux" ] && [ "$arch" = "arm64" ]; then
  echo "No linux-arm64 binary is published yet — build from source with Bun instead." >&2
  exit 1
fi

asset="steck-${os}-${arch}"
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

echo "Installing steck (${os}-${arch}) from ${REPO}…"
mkdir -p "$BIN_DIR"
tmp="$(mktemp)"
curl -fsSL "$url" -o "$tmp"
chmod +x "$tmp"
mv "$tmp" "$BIN_DIR/steck"

echo "Installed to $BIN_DIR/steck"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: $BIN_DIR is not on your PATH — add it to your shell profile." ;;
esac
"$BIN_DIR/steck" --version >/dev/null 2>&1 && "$BIN_DIR/steck" --version || true
echo "Run 'steck doctor' to check your environment."
