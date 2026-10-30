---
title: Ready and order list only work, not requirements
kind: behaviour-change
affects:
  - usage
checks:
  - added dependencies-wait-on-work
---

`naima ready` and `naima order` now leave requirements out, since a requirement is a standard to meet rather than a piece of work. When an item is blocked by an
open requirement, `naima check` notes it and suggests waiting on the work that delivers or proves the requirement instead.
