---
title: the branch that sets the landing host can land, and a heavy landing check can say which files it covers
kind: behaviour-change
affects:
  - workflow
  - api
commands:
  - changed land
---

`naima land` reads the coordination option `landingHost` from the configuration of the branch being landed first, then from the trunk's, so the branch
that names the landing host lands by it. A heavy landing check may give `covers(ctx, landing)`, the files of the landing it reads, computed where
`naima land` runs: when it covers none, the check is not needed, runs nowhere and needs no landing host, and `naima land` prints
`<check>: not needed, the landing changes no file it covers`.
