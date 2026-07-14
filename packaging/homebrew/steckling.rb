# Homebrew formula for Steckling (v0.1.0).
#
# This is the canonical source. To publish the tap:
#   1. Copy this file to timd/homebrew-steckling as Formula/steckling.rb.
#   2. Ensure timd/steckling and the release assets are public (brew downloads them anonymously).
# Users then: brew install timd/steckling/steckling
#
# On each release, bump `version`, the v<version> URLs, and the three sha256 values
# (from the release's checksums.txt). See RELEASING.md.
class Steckling < Formula
  desc "A git worktree + isolated Docker service stack per branch, for parallel dev"
  homepage "https://github.com/timd/steckling"
  version "0.1.0"
  license "MIT"

  depends_on "git"
  # Docker (Engine or Desktop) is required at runtime but is not a Homebrew dependency.

  on_macos do
    on_arm do
      url "https://github.com/timd/steckling/releases/download/v0.1.0/steck-darwin-arm64"
      sha256 "ff94521871d6859bac2a98d424144d8653968a211edb4236845c7dc7bf304e4b"
    end
    on_intel do
      url "https://github.com/timd/steckling/releases/download/v0.1.0/steck-darwin-x64"
      sha256 "2bdefd73871c7502cd04beae84473609a7f6b08147054f20c84514f27e33bcfd"
    end
  end

  on_linux do
    url "https://github.com/timd/steckling/releases/download/v0.1.0/steck-linux-x64"
    sha256 "3afc6cc58274ad6f88029e86f4b076bcc24fc420db416cff5722fa75674c4583"
  end

  def install
    bin.install Dir["steck-*"].first => "steck"
  end

  test do
    assert_match "steck", shell_output("#{bin}/steck --help")
  end
end
