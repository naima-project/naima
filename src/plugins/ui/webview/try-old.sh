#!/bin/sh
# try-old.sh <image> <runtime-packages> <library-dir> <window-main.ts> <deno>: in a container of <image> holding only
# the runtime packages, run the window (window-main.ts) under a virtual display, first with the published webview
# library, then with the one in <library-dir>, and say which stays up. For example, from this folder on a Linux host:
#   sh try-old.sh ubuntu:20.04 "libwebkit2gtk-4.0-37 libgtk-3-0" linux/gtk3-webkit40 ../window-main.ts "$(command -v deno)"
IMG=$1; PKG=$2; LIB=$(cd "$3" && pwd); MAIN=$(cd "$(dirname "$4")" && pwd)/$(basename "$4"); DENO=$5
CT=${CONTAINER:-podman}
$CT run --rm -e DEBIAN_FRONTEND=noninteractive -v "$DENO":/usr/local/bin/deno:ro -v "$LIB":/lib-wv:ro -v "$MAIN":/w/window-main.ts:ro "$IMG" sh -c "
  apt-get -qq update >/dev/null && apt-get -qq install -y --no-install-recommends ca-certificates xvfb $PKG >/dev/null 2>&1
  Xvfb :9 >/dev/null 2>&1 & export DISPLAY=:9; sleep 2
  for how in published ours; do
    if [ \$how = ours ]; then export PLUGIN_URL=file:///lib-wv/; fi
    deno run -A /w/window-main.ts 'data:text/html,<h1>hi</h1>' Probe > /tmp/\$how.log 2>&1 & P=\$!
    sleep 12
    if kill -0 \$P 2>/dev/null; then echo \"\$how: window up after 12 s\"; kill \$P; else echo \"\$how: ended: \$(tail -1 /tmp/\$how.log | cut -c1-220)\"; fi
  done
"
