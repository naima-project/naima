---
title: naima run refuses --no-progress without --stale
kind: breaking
affects:
  - api
  - usage
  - workflow
commands:
  - changed run
rules:
  - changed Long work reports its progress, or says why it cannot and what it reports instead
---

A run started with `naima run ... --no-progress "<reason>"` must also give `--stale <duration>`, how long silence is normal for that command; `naima run`
refuses the launch without it, saying so in one line. A long run declared in `longRuns` with `noProgress` gives `stale` too, and starts with it. Runs that
report progress keep the one-minute default. Scripts and declarations that start a run with `--no-progress` alone add `--stale` with the window that suits the
command.
