---
title: Long work runs through naima run and naima wait
kind: feature
affects:
  - api
  - workflow
commands:
  - added run
  - added wait
checks:
  - added wait-loops
rules:
  - added Long work goes through naima run and naima wait
---

A command that may take more than a few minutes, or that runs on another machine, is started with `naima run` and a time budget, and waited on with
`naima wait`. `naima run list` shows what is running, and `naima run clean` removes what a run created. A hand-written wait loop in a session or a script is
reported by `naima check`.
