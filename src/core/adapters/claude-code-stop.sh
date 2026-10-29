#!/bin/sh
# Claude Code's turn-end (Stop) hook for Naima (src/core/adapters/claude-code.ts).
# It must cost nothing at the end of a turn when nothing can be due, so it
# starts no Deno then: the tick leaves the next time anything can be due as
# the name of a file, wake/<epoch seconds>, in its folder in the clone's git
# directory, and this script only compares those names with the clock. When
# one has come, or the tick has never run, it runs naima tick --hook
# claude-code, which prints {"decision":"block","reason":"..."} when the owner
# has to be told something, and nothing otherwise. Before that, a cheap
# capture check (below) may stop the turn once. A stop that a hook has
# already continued (stop_hook_active) passes at once: it never blocks twice
# in a row.

input=$(cat)
case $input in
  *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd) || exit 0
launcher="$here/../../../naima.ts"
# The committed launcher beside the program, which finds the Deno it installed, when there is one.
committed="$here/../../../../naima.sh"
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
common=$(cd "$root" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null) || exit 0
case $common in
  /* | [A-Za-z]:*) ;;
  *) common="$root/$common" ;;
esac

# Capture: a turn that changed the project's files while nothing in the
# tracker changed is stopped once, for the agent to judge whether the owner
# asked, decided or reported something to file. Git alone, no Deno: each stop
# keeps the content of the files outside the tracker and of the tracker data
# (its own repository when the tracker is private), as the tree hashes git
# gives them through a scratch index, so committing changes nothing; and
# compares them with the previous stop's.
data="$root/naima-tracker/naima-data"
# The tree of the working files of the repository at $1, as git would commit them.
worktree() {
  scratch=$(mktemp) || return 1
  index=$(cd "$1" && git rev-parse --git-path index) || { rm -f "$scratch"; return 1; }
  case $index in /* | [A-Za-z]:*) ;; *) index="$1/$index" ;; esac
  # -p keeps the index's own time: git checks by content every entry no older than the index (racily clean), and a copy
  # stamped now would trust the size and time of a file changed in the same second as the index was written.
  cp -p "$index" "$scratch" 2>/dev/null || : > "$scratch"
  (cd "$1" && GIT_INDEX_FILE=$scratch git add -A . && GIT_INDEX_FILE=$scratch git write-tree) 2>/dev/null
  rm -f "$scratch"
}
if [ -d "$data" ] && tree=$(worktree "$root") && [ -n "$tree" ]; then
  code=$(cd "$root" && git ls-tree "$tree" | grep -v "	naima-tracker$" | cksum)
  if [ -e "$data/.git" ]; then kept=$(worktree "$data"); else kept=$(cd "$root" && git rev-parse -q --verify "$tree:naima-tracker/naima-data"); fi
  mark="$common/naima/tick/capture"
  last=$(cat "$mark" 2>/dev/null)
  mkdir -p "$common/naima/tick" 2>/dev/null && printf '%s\n%s\n' "$code" "$kept" > "$mark"
  if [ -n "$last" ]; then
    was_code=$(printf '%s\n' "$last" | sed -n 1p)
    was_kept=$(printf '%s\n' "$last" | sed -n 2p)
    if [ "$code" != "$was_code" ] && [ "$kept" = "$was_kept" ]; then
      echo '{"decision":"block","reason":"Naima: this turn changed the project but nothing in the tracker. Judge what the owner said since the last turn: a request, a decision, a report or a deferral that is settled is filed now (naima new, deduped, in your own words); something the owner is still thinking aloud about gets one question at the end, asking whether to file it; if nothing was settled, say nothing about it and end the turn."}'
      exit 0
    fi
  fi
fi

[ -f "$committed" ] || command -v deno >/dev/null 2>&1 || exit 0
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
if [ -f "$committed" ]; then
  sh "$committed" tick --hook claude-code </dev/null || exit 0
else
  deno run -A "$launcher" tick --hook claude-code </dev/null || exit 0
fi
