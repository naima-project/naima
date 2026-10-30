---
title: Every command ticks, and Naima tells the owner what is due during a long session
kind: feature
affects:
  - api
  - usage
  - workflow
commands:
  - added tick
  - added messages
  - changed hello
  - changed init
  - changed update
action: "Run naima update once, then commit what it says it wrote (the new pointer line, and the hooks in a tool's settings such as .claude/settings.json) together with the update."
---

Naima still runs no program in the background. Every naima command now starts with the tick, which does what is due: once a day it asks Naima's source whether a
newer version exists, with a short time limit and unless `updates` is off, and once an hour it looks for long runs that are due. A failed check is tried again
an hour later. Any number of naima processes, in any worktree of a clone, can tick at the same time without a lock: each decision is a file only one of them can
create, kept in the clone's git directory and never committed. Plugins can add jobs to the tick through the new extension point `jobs`.

What the tick finds for the owner is a message. Every command prints the messages due after its own output, on standard error, as `NAIMA-MESSAGE` followed by
JSON (`id`, `level`, `text`, `ack`). An info message is said once. When the update check has failed every day for a week, the tick raises an urgent message, an
item of the new core type `messages`, said once an hour until the owner acknowledges it with `naima messages ack <id>`. `naima messages` lists them, and
`naima tick` runs the tick at once.

For Claude Code, `naima init` and `naima update` now install a second hook, at the end of each agent turn. A small script starts Naima only when something can
be due, and then has the agent tell the owner, at most once in a row. The session-start hook now runs `naima hello --hook claude-code`, so the owner sees the
greeting directly, and the agent is told what to say first. The pointer line asks every agent to tell the owner what a NAIMA-MESSAGE line says, and never to
acknowledge a message for them.
