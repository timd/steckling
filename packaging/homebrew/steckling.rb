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
      sha256 "faeec4f5ba5712f1d2e5da4b34b77a89c75b5240b7edbcd5ce689f80a0ff95ca"
    end
    on_intel do
      url "https://github.com/timd/steckling/releases/download/v0.1.0/steck-darwin-x64"
      sha256 "b55a6a50e3350241b854e95672b80dd755ec2e8b5db9b4c1d25354377d370101"
    end
  end

  on_linux do
    url "https://github.com/timd/steckling/releases/download/v0.1.0/steck-linux-x64"
    sha256 "66603a8fc74b0d73cb15535e96557bfdcb8cf067e1e9d87425066c52a7f25615"
  end

  def install
    bin.install Dir["steck-*"].first => "steck"
  end

  test do
    assert_match "steck", shell_output("#{bin}/steck --help")
  end
end
