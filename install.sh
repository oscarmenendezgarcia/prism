#!/usr/bin/env sh
# install.sh — Prism Kanban one-liner installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/oscarmenendezgarcia/prism/main/install.sh | sh
#
# Pass extra args to `prism init` via sh -s:
#   curl -fsSL .../install.sh | sh -s -- --data-dir /custom/path --force
#
# Requirements: sh (POSIX), curl or wget, internet access
# Node.js >=20 is installed automatically via nvm if missing or outdated.

set -e

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PRISM_CYAN='\033[0;36m'
PRISM_GREEN='\033[0;32m'
PRISM_YELLOW='\033[1;33m'
PRISM_RED='\033[0;31m'
PRISM_RESET='\033[0m'

_print() {
  printf '%b\n' "$1"
}

info()    { _print "${PRISM_CYAN}[prism]${PRISM_RESET} $1"; }
success() { _print "${PRISM_GREEN}[prism]${PRISM_RESET} $1"; }
warn()    { _print "${PRISM_YELLOW}[prism]${PRISM_RESET} $1"; }
error()   { _print "${PRISM_RED}[prism] ERROR:${PRISM_RESET} $1" >&2; exit 1; }

# Minimum required Node.js major version (matches package.json engines.node >=20)
NODE_MIN_MAJOR=20

# NVM installer URL (pinned to a stable release)
NVM_INSTALL_URL="https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh"

# ---------------------------------------------------------------------------
# Step 1 — Detect / source nvm
# ---------------------------------------------------------------------------

_source_nvm() {
  NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck source=/dev/null
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
    return 0
  fi
  return 1
}

# Try to source nvm before checking Node (user may have nvm but not in PATH yet)
_source_nvm || true

# ---------------------------------------------------------------------------
# Step 2 — Check Node.js version; install via nvm if missing / outdated
# ---------------------------------------------------------------------------

_node_major() {
  # Extracts the major version number from `node --version` (e.g. v22.1.0 → 22)
  node --version 2>/dev/null | sed 's/v//' | cut -d. -f1
}

_need_node() {
  if ! command -v node > /dev/null 2>&1; then
    return 0  # node not found
  fi
  major=$(_node_major)
  # Return 0 (need install) if major is less than required
  if [ "$major" -lt "$NODE_MIN_MAJOR" ] 2>/dev/null; then
    return 0
  fi
  return 1  # node is fine
}

if _need_node; then
  if command -v node > /dev/null 2>&1; then
    warn "Node.js $(_node_major).x found — need >=${NODE_MIN_MAJOR}. Installing LTS via nvm..."
  else
    info "Node.js not found. Installing LTS via nvm..."
  fi

  # Install nvm if not present
  if ! _source_nvm; then
    info "Installing nvm..."
    if command -v curl > /dev/null 2>&1; then
      curl -fsSL "$NVM_INSTALL_URL" | sh
    elif command -v wget > /dev/null 2>&1; then
      wget -qO- "$NVM_INSTALL_URL" | sh
    else
      error "curl or wget is required to install nvm. Please install one and retry."
    fi

    # Source nvm for the rest of this script
    _source_nvm || error "nvm installed but could not be sourced. Please restart your shell and run: npm install -g prism-kanban && prism init"
  fi

  info "Installing Node.js LTS via nvm..."
  nvm install --lts
  nvm use --lts
  nvm alias default 'lts/*'

  success "Node.js $(node --version) installed."
else
  success "Node.js $(node --version) detected (>=${NODE_MIN_MAJOR} required)."
fi

# Verify npm is available
if ! command -v npm > /dev/null 2>&1; then
  error "npm not found. Please ensure Node.js was installed correctly."
fi

# ---------------------------------------------------------------------------
# Step 3 — Install prism-kanban globally
# ---------------------------------------------------------------------------

info "Installing prism-kanban globally..."
npm install -g prism-kanban

# Verify the CLI is on PATH
if ! command -v prism > /dev/null 2>&1; then
  # nvm-managed bins may not be in PATH in non-interactive shells; try npm bin -g
  NPM_BIN_DIR="$(npm bin -g 2>/dev/null || true)"
  if [ -n "$NPM_BIN_DIR" ] && [ -x "$NPM_BIN_DIR/prism" ]; then
    export PATH="$NPM_BIN_DIR:$PATH"
  else
    warn "The 'prism' binary was not found in PATH after installation."
    warn "You may need to run: export PATH=\"\$(npm bin -g):\$PATH\""
    warn "Then run: prism init $*"
    exit 0
  fi
fi

success "prism $(prism --version) installed."

# ---------------------------------------------------------------------------
# Step 4 — Initialise Prism data directory
# ---------------------------------------------------------------------------

info "Running prism init $*..."
prism init "$@"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

success "Prism is ready!"
_print ""
_print "  ${PRISM_CYAN}Start the server:${PRISM_RESET}  prism start"
_print "  ${PRISM_CYAN}Open the UI:${PRISM_RESET}       http://localhost:3000"
_print ""
_print "  Add nvm to your shell profile to keep Node.js on PATH:"
_print "  ${PRISM_YELLOW}export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"${PRISM_RESET}"
_print ""
