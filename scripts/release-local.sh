#!/usr/bin/env bash
#
# Build the proxy tarball and (optionally) extract ace-server, then publish
# everything to a GitHub release with the `gh` CLI.
#
# Usage:
#   scripts/release-local.sh [--from <deveco.zip|dmg|app|install>]
#                            [--tag v0.1.0] [--repo owner/name]
#                            [--out dist-assets] [--skip-test] [--dry-run]
#
# Examples:
#   # proxy only
#   scripts/release-local.sh
#
#   # proxy + ace-server, published as v0.1.0
#   scripts/release-local.sh --from ~/Downloads/devecostudio-mac.zip --tag v0.1.0
#
# The DevEco archive is Huawei proprietary software; do not commit it.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

FROM=""
TAG=""
REPO=""
OUT="dist-assets"
SKIP_TEST=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --skip-test) SKIP_TEST=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help)
      sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "node is required"
command -v npm >/dev/null || die "npm is required"

VERSION="$(node -p "require('./package.json').version")"
[[ -n "$TAG" ]] || TAG="v$VERSION"

log "installing dependencies"
npm ci

if [[ "$SKIP_TEST" == "0" ]]; then
  log "running tests"
  npm test
fi

rm -rf "$OUT"
mkdir -p "$OUT"

log "packing the launcher"
npm pack --pack-destination "$OUT"

if [[ -n "$FROM" ]]; then
  [[ -e "$FROM" ]] || die "source not found: $FROM"
  log "extracting ace-server from $FROM"
  node extractor/extract-ace-server.mjs --from "$FROM" --out "$OUT"
fi

log "release assets:"
ls -lh "$OUT"

if [[ "$DRY_RUN" == "1" ]]; then
  log "dry-run: skipping gh release"
  exit 0
fi

command -v gh >/dev/null || die "gh CLI is required to publish (or use --dry-run)"

GH_ARGS=()
[[ -n "$REPO" ]] && GH_ARGS+=(--repo "$REPO")

if gh release view "$TAG" "${GH_ARGS[@]}" >/dev/null 2>&1; then
  log "uploading assets to existing release $TAG"
  gh release upload "$TAG" "$OUT"/* "${GH_ARGS[@]}" --clobber
else
  log "creating release $TAG"
  gh release create "$TAG" "$OUT"/* \
    "${GH_ARGS[@]}" \
    --title "$TAG" \
    --generate-notes \
    --notes "ace-server is Huawei proprietary software; see NOTICE."
fi

log "done: https://github.com/${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}/releases/tag/$TAG"
