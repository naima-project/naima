#!/bin/sh
# Naima's PreToolUse hook on Bash (src/core/adapters/claude-code.ts): a shell
# call given a tool timeout over a minute is refused, unless the command is
# naima run or naima wait. A command expected to outlast a minute goes through
# naima run (rule long-work/long-work-through-naima-run); a long tool timeout
# is how an agent sat for minutes on a command that never started.
#
# It runs before every Bash call of every agent, so it starts no Deno. It reads
# the call's top-level tool_input.timeout, a number of milliseconds, and the
# start of its command, each a flat "name": value pair: in a JSON string a
# quote is escaped, so text inside a value never reads as a field. The limit is
# the same as the check foreground-timeouts reads the transcripts with.

limit=60000
input=$(cat)
case $input in
  *'"timeout"'*) ;;
  *) exit 0 ;;
esac
timeout=$(printf '%s\n' "$input" | sed -n 's/.*"timeout"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1)
[ -n "$timeout" ] || exit 0
[ "$timeout" -gt "$limit" ] 2>/dev/null || exit 0
command=$(printf '%s\n' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
if printf '%s\n' "$command" | grep -Eq '^[[:space:]]*(naima|deno task naima|(sh |bash )?[^ ]*naima\.(sh|cmd)|deno run [^ ]+ [^ ]*naima\.ts|[^ ]*naima\.ts)[[:space:]]+(run|wait)([[:space:]]|$)'; then
  exit 0
fi
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Naima: a foreground command is never given a tool timeout over 60 seconds (this one: %s ms). A command expected to last more than a minute is started with naima run <name> --budget-time <duration> -- <command>, and waited on with naima wait <name> --timeout <duration shorter than a minute>, repeated, so one that never started or stopped advancing is seen within seconds. Run it that way, or drop the timeout if it is a short command."}}\n' "$timeout"
exit 0
