#!/bin/sh
# Claude Code's turn-end (Stop) hook for Naima (src/core/adapters/claude-code.ts).
# It must cost nothing at the end of a turn when nothing can be due, so it
# starts no Deno then: the tick leaves the next time anything can be due as
# the name of a file, wake/<epoch seconds>, in its folder in the clone's git
# directory, and this script only compares those names with the clock. When
# one has come, or the tick has never run, it runs naima tick --hook
# claude-code, which prints {"decision":"block","reason":"..."} when the owner
# has to be told something, and nothing otherwise. A stop that a hook has
# already continued (stop_hook_active) passes at once: it never blocks twice
# in a row.

input=$(cat)
case $input in
  *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac
command -v deno >/dev/null 2>&1 || exit 0
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd) || exit 0
launcher="$here/../../../naima.ts"
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
common=$(cd "$root" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null) || exit 0
case $common in
  /* | [A-Za-z]:*) ;;
  *) common="$root/$common" ;;
esac
wake="$common/naima/tick/wake"
due=yes
if [ -d "$wake" ]; then
  now=$(date +%s)
  for f in "$wake"/*; do
    [ -e "$f" ] || break
    name=${f##*/}
    case $name in '' | *[!0-9]*) continue ;; esac
    if [ "$name" -le "$now" ]; then
      due=yes
      break
    fi
    due=no
  done
fi
[ "$due" = yes ] || exit 0
cd "$root" || exit 0
deno run -A "$launcher" tick --hook claude-code </dev/null || exit 0
