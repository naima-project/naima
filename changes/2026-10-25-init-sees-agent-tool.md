---
title: init sees the agent tool it runs inside through the launcher, and suggests a todo first
kind: fix
affects:
  - usage
---

The launcher hands the program only an allow-listed environment, which left
out the variable that tells which agent tool Naima runs inside, so `naima
init` still installed no hooks in a fresh project. Each adapter now names the
variables it reads, and the launcher passes those on. After init, the next
step it suggests is a todo, `naima new todos "<the first thing to do>"`,
rather than a bug.
