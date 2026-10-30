---
title: init installs the hooks of the agent tool it runs inside, in a fresh project too
kind: fix
affects:
  - usage
  - workflow
---

`naima init` and `naima update` now count as in use the agent tool Naima is running inside, told by the environment the tool gives its commands, besides the
tools whose files the project already holds. An agent installing Naima in a new, empty repository now gets its session-start and turn-end hooks, so its next
session starts with `naima hello`; before, only the line in `AGENTS.md` was written. `naima.json`'s `agents`, when set, still decides alone.
