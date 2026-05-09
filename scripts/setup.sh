#!/usr/bin/env bash
# Storywright setup script
# Verifies prerequisites, installs dependencies, and prints next steps.

set -euo pipefail

# Colors (disabled if not a TTY or NO_COLOR is set)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET='\033[0m'
  C_BOLD='\033[1m'
  C_DIM='\033[2m'
  C_RED='\033[0;31m'
  C_GREEN='\033[0;32m'
  C_YELLOW='\033[0;33m'
  C_CYAN='\033[0;36m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''
fi

say()   { printf "%b\n" "$1"; }
ok()    { say "  ${C_GREEN}✓${C_RESET} $1"; }
warn()  { say "  ${C_YELLOW}!${C_RESET} $1"; }
fail()  { say "  ${C_RED}✗${C_RESET} $1"; }
step()  { say "${C_BOLD}${C_CYAN}▸${C_RESET} ${C_BOLD}$1${C_RESET}"; }

# Resolve repo root regardless of where the script is invoked from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$ROOT_DIR"

say ""
say "${C_BOLD}Storywright setup${C_RESET}"
say "${C_DIM}repository: ${ROOT_DIR}${C_RESET}"
say ""

# ── 1. Prerequisites ────────────────────────────────────────────────────────
step "Checking prerequisites"

MIN_NODE_MAJOR=18

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed."
  say "    Install Node.js ${MIN_NODE_MAJOR}+ from https://nodejs.org or via your package manager:"
  say "      ${C_DIM}# macOS${C_RESET}"
  say "      brew install node"
  say "      ${C_DIM}# Linux (with nvm)${C_RESET}"
  say "      nvm install --lts"
  exit 1
fi

NODE_VERSION="$(node --version)"
NODE_MAJOR="$(printf '%s' "$NODE_VERSION" | sed -E 's/^v([0-9]+)\..*/\1/')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  fail "Node.js ${NODE_VERSION} is too old. Storywright requires Node ${MIN_NODE_MAJOR}+."
  say "    Upgrade Node.js, then re-run this script."
  exit 1
fi
ok "Node.js ${NODE_VERSION}"

if ! command -v npm >/dev/null 2>&1; then
  fail "npm is not installed (it ships with Node.js — please reinstall Node)."
  exit 1
fi
ok "npm $(npm --version)"

if command -v git >/dev/null 2>&1; then
  ok "git $(git --version | awk '{print $3}')"
else
  warn "git not found — fine for running the app, but you'll want it for development."
fi

say ""

# ── 2. Install dependencies ─────────────────────────────────────────────────
step "Installing dependencies"

# Prefer `npm ci` when a lockfile is present and clean; fall back to `npm install`.
if [ -f package-lock.json ]; then
  if npm ci --no-audit --no-fund 2>/dev/null; then
    ok "Installed via npm ci"
  else
    warn "npm ci failed (likely lockfile drift) — falling back to npm install"
    npm install --no-audit --no-fund
    ok "Installed via npm install"
  fi
else
  npm install --no-audit --no-fund
  ok "Installed via npm install"
fi

say ""

# ── 3. Sanity checks ────────────────────────────────────────────────────────
step "Verifying setup"

if [ ! -d node_modules ]; then
  fail "node_modules/ missing after install — something went wrong."
  exit 1
fi
ok "node_modules present"

# Run the validate-bible smoke check (fast, validates the constraint registry)
if node scripts/validate-bible.js >/dev/null 2>&1; then
  ok "Constraint registry in sync"
else
  warn "Constraint registry check produced output — run 'npm run validate:bible' for details."
fi

say ""

# ── 4. Optional: .env ───────────────────────────────────────────────────────
if [ -f .env.example ] && [ ! -f .env ]; then
  step "Environment file"
  say "  ${C_DIM}.env.example exists; .env was not created automatically because Storywright${C_RESET}"
  say "  ${C_DIM}does not require any environment variables (API keys are entered in-app).${C_RESET}"
  say "  ${C_DIM}If you want one anyway, run:${C_RESET}  cp .env.example .env"
  say ""
fi

# ── 5. Done ─────────────────────────────────────────────────────────────────
say "${C_GREEN}${C_BOLD}You're ready.${C_RESET}"
say ""
say "  Start the dev server:  ${C_BOLD}npm run dev${C_RESET}"
say "  Then open:             ${C_BOLD}http://localhost:5173${C_RESET}"
say ""
say "  ${C_DIM}You'll be prompted for an Anthropic API key on first launch.${C_RESET}"
say "  ${C_DIM}Get one at https://console.anthropic.com — it's stored in your browser only.${C_RESET}"
say ""
say "  Other commands:"
say "    ${C_BOLD}npm test${C_RESET}        Run the test suite"
say "    ${C_BOLD}npm run build${C_RESET}   Build for production"
say "    ${C_BOLD}make help${C_RESET}       List all available make targets"
say ""
