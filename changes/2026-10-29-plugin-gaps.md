---
title: Plugins contribute agent hooks, refuse a landing as a failure, and declare what their checks run; agents record their reviews
kind: fix
affects:
  - api
  - usage
  - workflow
commands:
  - added reviewed
  - changed land
  - changed init
  - changed update
  - changed stance
---

A plugin can now ask the agent tool to run one of its commands, under the new `agent-hooks` point: an event, an optional matcher and the naima command.
Naima installs the hook in the tool's settings beside its own and the project's at `naima init`, `naima update` and `naima stance adopt`, rewrites it in place
when it changes, and removes it once the plugin is gone; `naima check` notes one missing or left behind. A plugin no longer needs to write
`.claude/settings.json` itself.

A landing report can now `refuse` a landing, for a check that fails on the branch's files. `naima land` reports this as a failing check rather than as proofs
not current, and `--stale-proofs` no longer lets it through. A check can declare the programs it starts with `runs`, which the launcher allows, as a
verifier's could. These three are contract 4.

`naima reviewed <rule> --item <item> "<what was checked>"` records that an agent did the review a rule verified by `agent` asks for. `naima land` prints the
reviews a branch carries, and notes a landing that changes a file such a rule `covers` with no review recorded.

Run from a git hook in a linked worktree, Naima fetching a plugin from git no longer runs git in the hook's repository: under Deno, a variable removed from a
child's environment was still inherited, so the fetch failed and could touch the outer repository's index.
