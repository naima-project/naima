---
title: a heavy landing check runs on this machine when no landing host is named
kind: behaviour-change
affects:
  - workflow
commands:
  - changed land
---

`naima land` no longer refuses a landing a heavy check applies to when the coordination option `landingHost` is unset: it runs the check on this
machine, detached through `naima run` with its progress and log, in a checkout of the branch tip, waits on it with `naima wait` and refuses the landing
only when the check fails or cannot run. `landingHost` set to `here` does the same; a named host keeps running the check there through
`naima run --host`. `naima land` may now read and run the Deno that runs it, to start that run.
