#!/bin/sh
# Usage: scripts/build.sh <linux-amd64|linux-arm64|darwin-arm64|windows-amd64|host> [--with <module dir>]...
# Dev build by default (version shows "(nightly, <sha>)"); PVX_RELEASE_BUILD=1 gives the plain version.
# PVX_DEV_BUILD=1 (`bun run build:dev`) makes a dev build that may embed local module checkouts with --with: the
# artifact is dist/pvx-<version>-dev.<date>.<time>-<host sha>[-dirty]-<target>.tar.gz, with BUILD.txt beside the binary.
# Test hooks: PVX_ENTRY (entry file), PVX_DIST (output dir), PVX_SKIP_DEPS=1,
# PVX_PROFILES_SRC (dir whose *.json are embedded instead of the git-tracked profiles/*.json).
set -eu
cd "$(dirname "$0")/.."

target="${1:?uso: scripts/build.sh <os-arch|host> [--with <diretório do módulo>]...}"
shift
entry="${PVX_ENTRY:-./apps/pvx/src/index.ts}"
dist="${PVX_DIST:-dist}"
version="$(bun -e 'console.log(require("./package.json").version)')"

# --with only exists in a dev build: a release must never carry a module checkout. "$@" keeps the pairs for the plan.
with_count=0
expect_dir=0
for arg in "$@"; do
  if [ "$expect_dir" = 1 ]; then expect_dir=0; continue; fi
  [ "$arg" = --with ] || { echo "build: argumento desconhecido: $arg" >&2; exit 2; }
  expect_dir=1
  with_count=$((with_count + 1))
done
[ "$expect_dir" = 0 ] || { echo "build: --with pede o diretório do módulo" >&2; exit 2; }
if [ "$with_count" -gt 0 ] && [ "${PVX_DEV_BUILD:-}" != 1 ]; then
  echo "build: --with só existe em \`bun run build:dev\`" >&2; exit 2
fi
if [ "${PVX_DEV_BUILD:-}" = 1 ] && [ "${PVX_RELEASE_BUILD:-}" = 1 ]; then
  echo "build: uma build de release não pode ser build:dev" >&2; exit 2
fi

build_id=""
if [ "${PVX_DEV_BUILD:-}" = 1 ]; then
  : # the mark comes from the plan below, after the module checkouts are validated
elif [ "${PVX_RELEASE_BUILD:-}" = 1 ]; then
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

mkdir -p "$dist/.gen"
rm -f "$dist/.gen/embedded.ts" "$dist/.gen/plan.env"
# Dev build: validate the checkouts and read the host's git state first (bun install below may touch the tree).
if [ "${PVX_DEV_BUILD:-}" = 1 ]; then
  bun scripts/dev-build.ts plan "$dist" "$target" "$@" || exit 2
  . "$dist/.gen/plan.env"
fi

[ "${PVX_SKIP_DEPS:-}" = 1 ] || [ "$target" = host ] || bun install --os='*' --cpu='*'

# Only git-tracked profiles are embedded: an untracked local file must never reach a release.
if [ -n "${PVX_PROFILES_SRC:-}" ]; then
  plist="$(ls "$PVX_PROFILES_SRC"/*.json 2>/dev/null || true)"
elif git rev-parse --git-dir >/dev/null 2>&1; then
  plist="$(git ls-files 'profiles/*.json')"
else
  echo "build: fora de um checkout git; embutindo profiles/*.json do diretório" >&2
  plist="$(ls profiles/*.json 2>/dev/null || true)"
fi
export PVX_PROFILE_FILES="$plist"

mkdir -p "$dist/.gen"
# Wrapper entry: embeds the selected profiles (sorted, like the dev dir) before the app starts. A dev build's modules
# (embedded.ts, written by the plan) are imported first, so the app finds them in the global when it starts.
bun -e '
const { existsSync, readFileSync } = require("node:fs");
const files = (process.env.PVX_PROFILE_FILES || "").split("\n").filter(Boolean).sort();
const profiles = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
console.error("build: perfis embutidos: " + (files.join(", ") || "nenhum"));
require("node:fs").writeFileSync(process.argv[1] + "/.gen/entry.ts",
  `${existsSync(process.argv[1] + "/.gen/embedded.ts") ? `import "./embedded.ts";\n` : ""}(globalThis as any).__PVX_PROFILES__ = ${JSON.stringify(profiles)};\nawait import(${JSON.stringify(require("node:path").resolve(process.argv[2]))});\n`);
' "$dist" "$entry"
out="$dist/pvx"
[ "$target" = windows-amd64 ] && out="$dist/pvx-windows-amd64.exe"
# A dev build compiles into a staging dir, where the binary and BUILD.txt are packed together.
pkg="$dist/.gen/pkg"
if [ "${PVX_DEV_BUILD:-}" = 1 ]; then
  rm -rf "$pkg"
  mkdir -p "$pkg"
  out="$pkg/pvx"
  [ "$target" = windows-amd64 ] && out="$pkg/pvx.exe"
fi

set -- --compile ${bt:+--target="$bt"} \
  --define "process.env.PVX_VERSION=\"$version\"" --define "process.env.PVX_NIGHTLY=\"$mark\"" \
  --define "process.env.PVX_DEV_BUILD=\"$build_id\""
case "$target" in linux-*) set -- "$@" --define "process.env.OPENTUI_LIBC='glibc'" ;; esac
bun build "$@" "$dist/.gen/entry.ts" --outfile "$out"

if [ "${PVX_DEV_BUILD:-}" = 1 ]; then
  cp "$dist/.gen/BUILD.txt" "$pkg/BUILD.txt"
  case "$target" in
    windows-amd64)
      mv "$pkg/pvx.exe" "$dist/$stem.exe"
      cp "$pkg/BUILD.txt" "$dist/$stem.BUILD.txt" ;;
    *) COPYFILE_DISABLE=1 tar -czf "$dist/$stem.tar.gz" -C "$pkg" pvx BUILD.txt ;;
  esac
  echo
  cat "$dist/.gen/BUILD.txt"
  echo "Para testar numa central:"
  echo "  $(cat "$dist/.gen/HINT.txt")"
  rm -rf "$dist/.gen"
  exit 0
fi
rm -rf "$dist/.gen"

case "$target" in
  windows-amd64) ;;
  *)
    COPYFILE_DISABLE=1 tar -czf "$dist/pvx-$target.tar.gz" -C "$dist" pvx
    rm "$dist/pvx"
    ;;
esac
