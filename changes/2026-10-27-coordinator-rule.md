---
title: "A working rule ships: the agent talking to the owner coordinates, and workers in the background do the work"
kind: feature
affects:
  - usage
---

The working rules gain one: the agent in the conversation is the coordinator, sends every piece of work to a background worker in its own worktree, and stays
in the conversation to answer, land and report. Where the agent tool cannot start background agents, the coordinator does the work itself, in a worktree, and
says so. Acknowledged as "Coordinator mode on"; a project retires it as `working-rules/coordinator-delegates`.
