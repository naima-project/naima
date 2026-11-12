---
title: on Windows, a run given its command as one string logs what that command prints
kind: behaviour-change
affects:
  - usage
commands:
  - changed run
---

On Windows, `naima run` no longer starts the command detached. A command given as one string runs through cmd, and a program it started, such as
`cmd /c echo hi` or a Naima on a landing host, wrote to a console of its own instead of the run's log: the run succeeded with nothing in its log, and a heavy
landing check on a Windows host gave no findings. The run's log now holds that output, as it does for a command given as separate words. A run's tree is still
ended through taskkill.
