#!/bin/sh
# Usage: scripts/build.sh <linux-amd64|linux-arm64|darwin-arm64|windows-amd64|host>
# Dev build by default (version shows "(nightly, <sha>)"); PVX_RELEASE_BUILD=1 gives the plain version.
# Test hooks: PVX_ENTRY (entry file), PVX_DIST (output dir), PVX_SKIP_DEPS=1.
set -eu
cd "$(dirname "$0")/.."

target="${1:?uso: scripts/build.sh <os-arch|host>}"
entry="${PVX_ENTRY:-./apps/pvx/src/index.ts}"
dist="${PVX_DIST:-dist}"
version="$(bun -e 'console.log(require("./package.json").version)')"

if [ "${PVX_RELEASE_BUILD:-}" = 1 ]; then
  mark=""
else
  sha="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  mark="nightly, $sha"
fi

case "$target" in
  linux-amd64) bt=bun-linux-x64 ;;
  linux-arm64) bt=bun-linux-arm64 ;;
  darwin-arm64) bt=bun-darwin-arm64 ;;
  windows-amd64) bt=bun-windows-x64 ;;
  host) bt= ;;
  *) echo "alvo desconhecido: $target" >&2; exit 2 ;;
esac

[ "${PVX_SKIP_DEPS:-}" = 1 ] || [ "$target" = host ] || bun install --os='*' --cpu='*'

mkdir -p "$dist/.gen"
# Wrapper entry: embeds profiles/*.json (sorted, like the dev dir) before the app starts.
bun -e '
const { readdirSync } = require("node:fs");
const profiles = readdirSync("profiles").filter((n) => n.endsWith(".json")).sort().map((n) => require("./profiles/" + n));
require("node:fs").writeFileSync(process.argv[1] + "/.gen/entry.ts",
  `(globalThis as any).__PVX_PROFILES__ = ${JSON.stringify(profiles)};\nawait import(${JSON.stringify(require("node:path").resolve(process.argv[2]))});\n`);
' "$dist" "$entry"
out="$dist/pvx"
[ "$target" = windows-amd64 ] && out="$dist/pvx-windows-amd64.exe"

set -- --compile ${bt:+--target="$bt"} \
  --define "process.env.PVX_VERSION=\"$version\"" --define "process.env.PVX_NIGHTLY=\"$mark\""
case "$target" in linux-*) set -- "$@" --define "process.env.OPENTUI_LIBC='glibc'" ;; esac
bun build "$@" "$dist/.gen/entry.ts" --outfile "$out"
rm -rf "$dist/.gen"

case "$target" in
  windows-amd64) ;;
  *)
    COPYFILE_DISABLE=1 tar -czf "$dist/pvx-$target.tar.gz" -C "$dist" pvx
    rm "$dist/pvx"
    ;;
esac
