---
title: naima check tells what it is running, and leaves out heavy checks unless given --heavy
kind: behaviour-change
affects:
  - usage
commands:
  - changed check
---

`naima check` writes each check's name to standard error as it starts, and how long it took when that was a second or more. A check that takes minutes, such as a stance's browser checks, is heavy: a plugin declares it with `heavy: true`, and a check of a plugin pinned to a source of its own that starts an external program is heavy without saying so. `naima check` leaves heavy checks out and names them on its last lines; `naima check --heavy` runs them. A project with a stance had a check that did not end within an hour.
