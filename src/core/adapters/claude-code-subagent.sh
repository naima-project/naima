#!/bin/sh
# Claude Code's guard on sub-agents for Naima (src/core/adapters/claude-code.ts,
# src/core/subagents.ts): every sub-agent reads the project's rules before it
# acts. Run with one argument:
#
#   tool  as the PreToolUse hook on Bash and the tools that write files. A call
#         of the main session (no agent_id) passes at once. A sub-agent's call
#         passes when its mark exists, left by naima subagent --hook as it
#         started, or by this script when it runs naima rules; any other call
#         is denied, with the command that reads the rules as the reason.
#   stop  as the SubagentStop hook. A sub-agent with a mark passes, and its
#         marks are removed (a resumed sub-agent is given the rules again). One
#         without, that is not one of Claude Code's own internal agents (an
#         empty agent_type), is logged and sent back once to read the rules,
#         check its work against them and say in its report that it started
#         without them; a stop a hook already continued passes.
#
# No Deno: it runs before every such call. It reads three top-level string
# fields of the hook's input, agent_id, agent_type and tool_name, and the
# command of a Bash call, each a flat "name": "value" pair: in a JSON string
# a quote is escaped, so text inside a value never reads as a field.

mode=$1
input=$(cat)
case $input in
  *'"agent_id"'*) ;;
  *) exit 0 ;;
esac
field() {
  printf '%s\n' "$input" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
}
id=$(field agent_id)
case $id in '' | *[!A-Za-z0-9_.-]*) exit 0 ;; esac
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
common=$(cd "$root" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null) || exit 0
case $common in
  /* | [A-Za-z]:*) ;;
  *) common="$root/$common" ;;
esac
dir="$common/naima/subagents"
read_rules='naima rules --audience agents (deno task naima rules --audience agents, or deno run -A <the program>/naima.ts rules --audience agents)'

case $mode in
  tool)
    [ -e "$dir/$id" ] && exit 0
    if [ "$(field tool_name)" = Bash ]; then
      case $(field command) in
        *naima*' rules'*)
          mkdir -p "$dir" 2>/dev/null && echo read > "$dir/$id"
          exit 0
          ;;
      esac
    fi
    mkdir -p "$dir" 2>/dev/null && : > "$dir/$id.held"
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Naima: this project requires every sub-agent to read its rules before it acts, and you have not. Run %s first, obey what it says, then retry this call."}}\n' "$read_rules"
    ;;
  stop)
    if [ -e "$dir/$id" ]; then
      rm -f "$dir/$id" "$dir/$id.held"
      exit 0
    fi
    [ -n "$(field agent_type)" ] || exit 0
    mkdir -p "$dir" 2>/dev/null && printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(field agent_type)" "$id" >> "$dir/skipped"
    case $input in
      *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
    esac
    printf '{"decision":"block","reason":"Naima: you worked without reading this project'"'"'s rules. Run %s now, check what you did against them and fix what breaks one, then end with a report that says you started without reading them."}\n' "$read_rules"
    ;;
esac
exit 0
