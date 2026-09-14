#!/usr/bin/env bash
#
# Build the vendored arkts-lsp-proxy fork (git submodule) to dist/.
#
# Usage: scripts/build-proxy.sh [--force]
#
# Idempotent: skips the build when dist/index.js already exists, unless --force
# is given. Fetches the submodule first if it has not been checked out.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SUB="$ROOT/vendor/harmony_arkts_lsp_proxy"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

if [[ ! -f "$SUB/package.json" ]]; then
  log "fetching submodule vendor/harmony_arkts_lsp_proxy"
  git -C "$ROOT" submodule update --init --recursive vendor/harmony_arkts_lsp_proxy
fi

if [[ "$FORCE" == "0" && -f "$SUB/dist/index.js" ]]; then
  log "proxy already built ($SUB/dist/index.js)"
  exit 0
fi

command -v npm >/dev/null || { echo "error: npm is required to build the proxy" >&2; exit 1; }

if [[ ! -d "$SUB/node_modules" ]]; then
  log "installing proxy dependencies"
  (cd "$SUB" && npm ci)
fi

log "building proxy"
(cd "$SUB" && npm run build)

log "done: $SUB/dist/index.js"
