#!/bin/sh
# Usage: scripts/check-artifact.sh <pvx-*.tar.gz>...
# Refuses an artifact that carries a development mark or modules embedded by `build:dev`. Used by release.sh.
# The three patterns are what the build puts in the binary: the nightly mark, the dev build id and the embedded-module marker.
# Host sources never contain them whole (version.ts builds the nightly mark from pieces; the dev ones arrive only through
# the build), so a hit is a real mark.
set -eu

for tarball in "$@"; do
  if tar -tzf "$tarball" | grep -qx 'BUILD.txt'; then
    echo "release: $tarball traz BUILD.txt: é uma build de desenvolvimento" >&2
    exit 1
  fi
  if tar -xzOf "$tarball" pvx | grep -qa -e 'nightly, ' -e 'dev-build:' -e 'pvx-embedded-module:'; then
    echo "release: $tarball contém a marca de desenvolvimento ou módulos embutidos" >&2
    exit 1
  fi
done
