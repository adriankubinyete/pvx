#!/bin/sh
# pvx installer: curl -fsSL https://raw.githubusercontent.com/adriankubinyete/pvx/main/install.sh | sudo sh
# Env: PVX_VERSION (tag, default latest), PVX_RELEASE_BASE, PVX_LIB_DIR, PVX_BIN_DIR, PVX_USRBIN_DIR.
set -eu

BASE="${PVX_RELEASE_BASE:-https://github.com/adriankubinyete/pvx/releases}"
LIB_DIR="${PVX_LIB_DIR:-/usr/local/lib/pvx}"
BIN_DIR="${PVX_BIN_DIR:-/usr/local/bin}"
# /usr/local/bin is outside sudo's secure_path on RHEL/Rocky: without this link `sudo pvx` fails.
USRBIN_DIR="${PVX_USRBIN_DIR:-/usr/bin}"

die() { echo "pvx: $*" >&2; exit 1; }

# 1. Platform
case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) die "sistema não suportado: $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) die "arquitetura não suportada: $(uname -m)" ;;
esac
if [ "$os" = linux ]; then
  if ls /lib/ld-musl-* /usr/lib/ld-musl-* >/dev/null 2>&1 || (ldd --version 2>&1 | grep -qi musl); then
    die "libc musl (Alpine) não é suportada; o pvx precisa de glibc"
  fi
fi
asset="pvx-$os-$arch.tar.gz"

# 2. Root, only when writing to the system paths
if [ -z "${PVX_LIB_DIR:-}" ] && [ "$(id -u)" != 0 ]; then
  die "precisa de root. Rode: curl -fsSL <url do install.sh> | sudo sh"
fi

# 3. Tools. The binary needs only glibc, tar and curl or wget, so yum is touched only when
# curl and wget are both missing. CentOS 7 is EOL and its mirrorlist is dead, which breaks ANY yum
# call, so the repos are fixed first (same fix as the Python pvx installer).
fix_dead_centos_mirrors() {
  for f in /etc/yum.repos.d/*.repo; do
    [ -f "$f" ] || continue
    grep -q '^mirrorlist=.*mirrorlist\.centos\.org' "$f" 2>/dev/null || continue
    sed -i -e 's|^mirrorlist=|#mirrorlist=|' \
           -e 's|^#\s*baseurl=http://mirror\.centos\.org|baseurl=https://mirrors.aliyun.com|' "$f"
  done
}
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  if command -v yum >/dev/null 2>&1; then fix_dead_centos_mirrors; yum install -y curl
  elif command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y curl
  else die "precisa de curl ou wget"; fi
fi
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 2 --connect-timeout 15 -o "$2" "$1"; }
else
  fetch() { wget -q -O "$2" "$1"; }
fi
command -v tar >/dev/null 2>&1 || die "precisa de tar"
if command -v sha256sum >/dev/null 2>&1; then sha() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die "precisa de sha256sum ou shasum"; fi

# 4. Download and verify in a temp dir; the install paths are untouched until everything checks out.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM
if [ -n "${PVX_VERSION:-}" ]; then url="$BASE/download/$PVX_VERSION"; else url="$BASE/latest/download"; fi
fetch "$url/$asset" "$tmp/$asset" || die "falha ao baixar $url/$asset"
fetch "$url/checksums-sha256.txt" "$tmp/checksums-sha256.txt" || die "falha ao baixar $url/checksums-sha256.txt"
want="$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1; exit }' "$tmp/checksums-sha256.txt")"
[ -n "$want" ] || die "$asset não consta em checksums-sha256.txt"
[ "$(sha "$tmp/$asset")" = "$want" ] || die "checksum diferente do esperado para $asset; nada foi instalado"
tar -xzf "$tmp/$asset" -C "$tmp" pvx || die "tarball inválido; nada foi instalado"
chmod +x "$tmp/pvx"

# 5. Install: binary first (atomic rename), then the links.
mkdir -p "$LIB_DIR" "$BIN_DIR" "$USRBIN_DIR"
cp "$tmp/pvx" "$LIB_DIR/.pvx.new"
mv -f "$LIB_DIR/.pvx.new" "$LIB_DIR/pvx"
ln -sf "$LIB_DIR/pvx" "$BIN_DIR/pvx"
ln -sf "$LIB_DIR/pvx" "$USRBIN_DIR/pvx"

echo "pvx instalado em $LIB_DIR/pvx"
"$LIB_DIR/pvx" version || true
