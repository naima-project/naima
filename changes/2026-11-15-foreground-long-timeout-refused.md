---
title: a shell command given a tool timeout over 60 seconds is refused, and naima check fails on one found in the agents' transcripts
kind: behaviour-change
affects:
  - usage
commands:
  - changed check
---

A command expected to last more than a minute goes through `naima run`, never the foreground. For Claude Code, `naima update` installs a PreToolUse hook on Bash that refuses a call with a tool timeout over 60 seconds unless the command is `naima run` or `naima wait`, and tells the agent to use `naima run`. The new check `foreground-timeouts` fails on any such call found in the transcripts of the project and its worktrees since the last session note. The rule on long work says so. An agent starts long commands with `naima run` and waits on them with `naima wait --timeout 50s`, as often as needed.
