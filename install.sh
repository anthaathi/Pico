#!/usr/bin/env bash
#
# Pi Server installer
# Usage: curl -fsSL https://raw.githubusercontent.com/anthaathi/pi-companion/main/install.sh | bash
#

set -euo pipefail

REPO="anthaathi/pi-companion"
INSTALL_DIR="${PI_SERVER_HOME:-$HOME/.pi-server}/bin"
BINARY_NAME="pi-server"

info()  { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
error() { printf "\033[1;31merror:\033[0m %s\n" "$*" >&2; exit 1; }

detect_platform() {
  local os arch

  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)  os="linux" ;;
    Darwin) os="macos" ;;
    *)      error "Unsupported OS: $os. Please download manually from https://github.com/$REPO/releases" ;;
  esac

  case "$arch" in
    x86_64|amd64)   arch="x86_64" ;;
    aarch64|arm64)   arch="aarch64" ;;
    *)               error "Unsupported architecture: $arch. Please download manually from https://github.com/$REPO/releases" ;;
  esac

  echo "${os}-${arch}"
}

get_latest_release_tag() {
  local tag
  tag="$(curl -fsSL -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/')"

  if [ -z "$tag" ]; then
    error "Could not determine the latest release. Check https://github.com/$REPO/releases"
  fi

  echo "$tag"
}

main() {
  info "Detecting platform..."
  local platform
  platform="$(detect_platform)"
  info "Platform: $platform"

  info "Fetching latest release..."
  local tag
  tag="$(get_latest_release_tag)"
  info "Latest release: $tag"

  local artifact="pi-server-${platform}"
  local url="https://github.com/$REPO/releases/download/${tag}/${artifact}"

  info "Downloading $artifact..."
  mkdir -p "$INSTALL_DIR"
  local dest="$INSTALL_DIR/$BINARY_NAME"

  if ! curl -fSL --progress-bar -o "$dest" "$url"; then
    error "Download failed. Check that a release exists for your platform at:\n  $url"
  fi

  chmod +x "$dest"
  info "Installed $BINARY_NAME to $dest"

  # Check if already on PATH
  if command -v "$BINARY_NAME" &>/dev/null; then
    info "Ready! Run 'pi-server init' to get started."
  else
    echo ""
    info "Add pi-server to your PATH by adding this to your shell profile:"
    echo ""
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    echo ""
    info "Then run 'pi-server init' to get started."
  fi
}

main
