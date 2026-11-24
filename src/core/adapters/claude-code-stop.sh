#!/bin/sh
# Claude Code's turn-end (Stop) hook for Naima (src/core/adapters/claude-code.ts).
#
# It never makes the model run again: it always exits 0, prints at most
# {"systemMessage":"..."}, which only the owner sees, and never a block, a
# continue or context for the model. It costs a few file reads: it starts no
# Deno and waits for nothing, and it never looks at the working tree.
#
# The tick leaves the next time anything can be due as the name of a file,
# wake/<epoch seconds>, in its folder in the clone's git directory; this script
# compares those names with the clock. When one has come, or the tick has never
# run, it starts naima tick --hook claude-code in the background and returns at
# once. The tick leaves what it has for the owner in the file "said" of that
# folder; the next turn's hook prints it as a systemMessage, and naima hello
# says it too. Every run of the hook that does nothing records why in the file
# "hook-log" (not due, tick running, no program), one line each.

input=$(cat)
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
tick="$common/naima/tick"
mkdir -p "$tick" 2>/dev/null || exit 0
now=$(date +%s)
log() { printf '%s %s\n' "$now" "$1" >> "$tick/hook-log" 2>/dev/null; }

# What an earlier run left for the owner.
if [ -s "$tick/said" ]; then
  # One message at a time: the tool takes one JSON object per hook.
  if mv "$tick/said" "$tick/said.$$" 2>/dev/null; then
    head -n 1 "$tick/said.$$"
    tail -n +2 "$tick/said.$$" > "$tick/said.rest.$$" 2>/dev/null
    [ -s "$tick/said.rest.$$" ] && mv "$tick/said.rest.$$" "$tick/said" || rm -f "$tick/said.rest.$$"
    rm -f "$tick/said.$$"
  fi
fi

# Start $1 (a command line for sh) in the background, its output to "said"; at most one at a time. With a second
# argument, once it is done and the tick left no wake time, the hook asks again in five minutes.
launch() {
  if [ -e "$tick/running" ]; then
    started=$(cat "$tick/running" 2>/dev/null)
    if [ "${started:-0}" -gt $((now - 120)) ] 2>/dev/null; then
      log "skipped: a tick is still running"
      return 1
    fi
  fi
  printf '%s\n' "$now" > "$tick/running"
  ( cd "$root" && out="$tick/out.$$" && sh -c "$1" </dev/null > "$out" 2>/dev/null; [ -s "$out" ] && cat "$out" >> "$tick/said"; [ -z "$2" ] || [ -n "$(ls "$tick/wake" 2>/dev/null)" ] || : > "$tick/wake/$((now + 300))"; rm -f "$out" "$tick/running" ) </dev/null >/dev/null 2>&1 &
}

[ -f "$committed" ] || command -v deno >/dev/null 2>&1 || { log "skipped: no program to run"; exit 0; }
if [ -f "$committed" ]; then
  run='sh "'$committed'"'
else
  run='deno run -A "'$launcher'"'
fi

# Context: the coordination plugin leaves the limits, in tokens, in the tick's folder while a coordinator holds the role
# (naima handover): handover-at for any model, and handover-at-models, one "<model id> <tokens>" line per model whose
# window it knows, each the lower of the coordinator's handover point and a worker's bound. The last assistant message of
# the transcript carries the context size (its input, cache-creation and cache-read tokens) and the model id, found here
# with grep alone; past that model's limit, naima handover --watch says whether this session is the coordinator (told to
# suggest a handover to the owner) or another session (told about its own bound), which it says to the owner. No limit file, no
# transcript, no usage: nothing.
limit=$(cat "$tick/handover-at" 2>/dev/null)
transcript=$(printf '%s' "$input" | sed -n 's/.*"transcript_path": *"\([^"]*\)".*/\1/p' | head -n 1)
if [ -n "$limit" ] && [ -n "$transcript" ] && [ -f "$transcript" ] && { [ -f "$committed" ] || command -v deno >/dev/null 2>&1; }; then
  line=$(tail -n 80 "$transcript" | grep '"type":"assistant"' | grep '"usage"' | tail -n 1)
  used=0
  for key in input_tokens cache_creation_input_tokens cache_read_input_tokens; do
    n=$(printf '%s' "$line" | grep -o "\"$key\":[0-9]*" | head -n 1 | cut -d: -f2)
    used=$((used + ${n:-0}))
  done
  model=$(printf '%s' "$line" | grep -o '"model":"[^"]*"' | head -n 1 | cut -d'"' -f4)
  if [ -n "$model" ]; then
    # A dated snapshot (claude-haiku-4-5-20251001) has the window of its model id.
    bare=$(printf '%s' "$model" | sed 's/-[0-9]\{8\}$//')
    own=$(awk -v m="$model" -v b="$bare" '$1 == m || $1 == b { print $2; exit }' "$tick/handover-at-models" 2>/dev/null)
    [ -n "$own" ] && limit=$own
  fi
  if [ -n "$line" ] && [ "$used" -ge "$limit" ] 2>/dev/null; then
    launch "$run handover --watch --hook claude-code --tokens $used${model:+ --model $model}"
  fi
fi

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
if [ "$due" = no ]; then
  log "skipped: not due"
  exit 0
fi
mkdir -p "$wake" 2>/dev/null
launch "$run tick --hook claude-code" wake
exit 0
