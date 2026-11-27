#!/bin/sh
# build-linux.sh <variant> <out-dir>, from this folder as `sh build-linux.sh gtk3-webkit40 linux`: build libwebview.<arch>.so from webview/webview 0.12.0 in a container, for
# Linux systems the published library (GTK 4, WebKitGTK 6, glibc 2.33 or newer) does not run on.
#   gtk3-webkit40: GTK 3 and WebKit2GTK 4.0 on Ubuntu 20.04, so it runs on glibc 2.31 or newer
#   gtk3-webkit41: GTK 3 and WebKit2GTK 4.1 on Ubuntu 22.04, for systems that have 4.1 and not 4.0
# The C++ runtime is linked in statically, so the library needs only glibc and the system's GTK and WebKitGTK.
set -eu
V=$1; OUT=$2
REV=0.12.0
case "$V" in
  gtk3-webkit40) IMG=ubuntu:20.04; PKG="libgtk-3-dev libwebkit2gtk-4.0-dev"; MOD="gtk+-3.0 webkit2gtk-4.0"; PRE="" ;;
  gtk3-webkit41) IMG=ubuntu:22.04; PKG="libgtk-3-dev libwebkit2gtk-4.1-dev"; MOD="gtk+-3.0 webkit2gtk-4.1"; PRE="" ;;
  *) echo "unknown variant $V" >&2; exit 2 ;;
esac
mkdir -p "$OUT/$V"
CT=${CONTAINER:-podman}
$CT run --rm -e DEBIAN_FRONTEND=noninteractive -v "$(cd "$OUT/$V" && pwd)":/out "$IMG" sh -euc "
  $PRE
  apt-get -qq update && apt-get -qq install -y --no-install-recommends ca-certificates git g++ pkg-config $PKG >/dev/null
  git clone -q --depth 1 --branch $REV https://github.com/webview/webview.git /src 2>/dev/null
  cd /src
  g++ -std=c++11 -O2 -shared -fPIC -fvisibility=hidden -DWEBVIEW_BUILD_SHARED -Icore/include core/src/webview.cc \
    \$(pkg-config --cflags --libs $MOD) -static-libstdc++ -static-libgcc -Wl,--as-needed \
    -o /out/libwebview.\$(uname -m).so
  git -C /src log -1 --format=%H > /out/SOURCE
  ldd --version | head -1 > /out/BUILT-ON
  objdump -T /out/libwebview.\$(uname -m).so | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1 > /out/NEEDS-GLIBC
"
