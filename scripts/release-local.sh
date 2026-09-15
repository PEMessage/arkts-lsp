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

log "preparing vendored proxy (git submodule)"
bash "$ROOT/scripts/build-proxy.sh"

log "installing dependencies"
npm ci

if [[ "$SKIP_TEST" == "0" ]]; then
  log "running tests"
  npm test
fi

rm -rf "$OUT"
mkdir -p "$OUT"

if [[ -z "$FROM" ]]; then
  # Fall back to the URL committed in ./deveco.url (same source the CI uses).
  _url="$(sed -e 's/#.*$//' "$ROOT/deveco.url" 2>/dev/null | sed -e 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' | head -n1 || true)"
  if [[ -n "$_url" ]]; then
    command -v curl >/dev/null || die "curl is required to download the DevEco archive"
    mkdir -p downloads
    FROM="downloads/$(basename "${_url%%\?*}")"
    log "downloading DevEco archive from deveco.url -> $FROM"
    curl -fL --retry 3 -o "$FROM" "$_url"
  fi
fi

# Extract ace-server into the repo root BEFORE packing, so `npm pack` bundles
# it into the launcher tarball (one download installs everything).
BUNDLED=0
if [[ -n "$FROM" ]]; then
  [[ -e "$FROM" ]] || die "source not found: $FROM"
  log "extracting ace-server from $FROM (bundled into the package)"
  node extractor/extract-ace-server.mjs --from "$FROM" --out "$ROOT" --force
  BUNDLED=1
fi

log "packing the launcher"
npm pack --pack-destination "$OUT"
# Stable, version-less asset name for nightly releases.
mv "$OUT"/arkts-lsp-*.tgz "$OUT"/arkts-lsp.tgz 2>/dev/null || true

if [[ "$BUNDLED" == "1" ]]; then
  # Also publish the standalone ace-server tarball and the extractor manifest,
  # under stable version-less names too.
  mv "$ROOT"/ace-server-*.tar.gz "$OUT"/ace-server.tar.gz 2>/dev/null || true
  [[ -f "$ROOT/manifest.json" ]] && mv "$ROOT/manifest.json" "$OUT"/manifest.json
  rm -f "$ROOT"/ace-server-*.tar.gz.sha256
  if [[ -f "$OUT/ace-server.tar.gz" ]]; then
    (cd "$OUT" && sha256sum ace-server.tar.gz > ace-server.tar.gz.sha256)
  fi
  # Drop the staged directory: its contents are now inside the npm tarball.
  rm -rf "$ROOT"/ace-server-*/
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

# Only upload files: $OUT also contains the staged ace-server directory, and
# `gh release upload` errors on directories.
ASSETS=()
while IFS= read -r f; do ASSETS+=("$f"); done < <(find "$OUT" -maxdepth 1 -type f | sort)

# Version-less, stable notes/title (never mention the package version).
NOTES="Built from $(git rev-parse --short HEAD 2>/dev/null || echo unknown).

## Assets

- \`arkts-lsp.tgz\` — one download; bundles the launcher, the extractor, the
  vendored \`arkts-lsp-proxy\` and a DevEco \`ace-server\` build.
- \`ace-server.tar.gz\` — the standalone language server, if you prefer to
  manage it yourself.

> \`ace-server\` is Huawei proprietary software and remains subject to DevEco
> Studio's license terms. See \`NOTICE\` in the repository."

if gh release view "$TAG" "${GH_ARGS[@]}" >/dev/null 2>&1; then
  log "uploading assets to existing release $TAG"
  gh release upload "$TAG" "${ASSETS[@]}" "${GH_ARGS[@]}" --clobber
  gh release edit "$TAG" "${GH_ARGS[@]}" --title "$TAG" --notes "$NOTES"
else
  log "creating release $TAG"
  gh release create "$TAG" "${ASSETS[@]}" \
    "${GH_ARGS[@]}" \
    --title "$TAG" \
    --notes "$NOTES"
fi

log "done: https://github.com/${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}/releases/tag/$TAG"
