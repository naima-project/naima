---
title: "Every sub-agent gets the project's rules before it acts, and who asked for an item can be corrected"
kind: feature
affects:
  - usage
  - workflow
commands:
  - added subagent
  - changed origin
---

In Claude Code, `naima init` and `naima update` now install three more hooks, on sub-agents. When a sub-agent starts, `naima subagent --hook claude-code` puts
the project's rules for agents in its context. A sub-agent that does not have them cannot run a command or write a file until it runs
`naima rules --audience agents`. One that stops without ever having had them is sent back once to read them and say so in its report. Other agent tools have no
hooks for sub-agents, so there the brief has to say it.

`naima origin --set <item> --asked-by <who>` sets who asked for an item, for example one that `naima origin --backfill` left as `unknown`. The rest of the
origin stays as it was, and the origin records each correction: what it said before, who changed it and when.
