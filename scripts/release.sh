#!/bin/sh
# Builds every release target in release mode, writes and verifies dist/checksums-sha256.txt.
# It NEVER publishes: the last line is the command a person runs after approval.
set -eu
cd "$(dirname "$0")/.."

version="$(bun -e 'console.log(require("./package.json").version)')"
dist="${PVX_DIST:-dist}"
targets="${PVX_TARGETS:-linux-amd64 linux-arm64 darwin-arm64}"

if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
  echo "release: precisa de sha256sum ou shasum" >&2; exit 1
fi
sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

# A stale tarball from an earlier (dev) build must never end up in the release.
mkdir -p "$dist"
rm -f "$dist"/pvx-*.tar.gz "$dist"/checksums-sha256.txt

export PVX_RELEASE_BUILD=1 PVX_DIST="$dist"
bun install --os='*' --cpu='*'
for t in $targets; do
  PVX_SKIP_DEPS=1 sh scripts/build.sh "$t"
done
echo "Perfis embutidos (revise antes de publicar):"
if [ -n "${PVX_PROFILES_SRC:-}" ]; then ls "$PVX_PROFILES_SRC"/*.json 2>/dev/null; else git ls-files 'profiles/*.json'; fi | sed 's/^/  /'

# The mark never reaches a release artifact (spec: release is never "nightly").
for t in $targets; do
  tar -xzOf "$dist/pvx-$t.tar.gz" pvx | grep -qa 'nightly, ' && { echo "release: pvx-$t contém a marca de desenvolvimento" >&2; exit 1; }
done

(cd "$dist" && sum pvx-*.tar.gz > checksums-sha256.txt && sum -c checksums-sha256.txt)

echo
echo "Release v$version pronta e verificada em $dist/. Nada foi publicado."
echo "Para publicar (manual e irreversível), rode:"
echo "  gh release create v$version $dist/*.tar.gz $dist/checksums-sha256.txt --repo adriankubinyete/pvx --title v$version"
