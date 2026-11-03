---
title: naima wait says at once when a run never started, has not started, or shows no progress
kind: behaviour-change
affects:
  - usage
  - workflow
commands:
  - changed wait
  - changed run
rules:
  - changed Long work goes through naima run and naima wait; no hand-written wait loop
---

`naima wait` prints its first line on standard error as soon as it starts waiting, and no longer leaves a run that is not running to the timeout. A run whose
supervisor died before it could start the command never started: every reader shows it failed, and `naima wait` returns at once with
`naima wait: <name> did not start`. A run whose command has still not been seen alive 10 seconds into the wait ends it with
`naima wait: <name> has not started`, exiting 1. A run that should report progress and has written no progress line after 10 seconds is said to show no
progress, while waiting and in the final report. `naima run` records its supervisor's process id in the run's folder, `supervisor.pid`, for this.

The rule on long work now says that a long command is never run directly under a long tool timeout: it is started with `naima run`, which returns once the
command is alive, and waited on with short timeouts, repeated.
