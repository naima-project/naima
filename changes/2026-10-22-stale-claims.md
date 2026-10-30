---
title: Claims whose work is done are stale, listed apart and noted by naima check
kind: fix
affects:
  - api
  - usage
commands:
  - changed claims
  - changed prune
checks:
  - added stale-claims
---

A claim is now stale when its branch is gone, when its branch is merged into the trunk and the merge brought its claim file there, or when every item it claims
is closed. `naima claims` lists stale claims apart, at the end, and no longer counts them as work in hand, in its listing, in `naima summary` or in the claims
panel. `naima check` adds one note per stale claim with the command that releases it, `naima prune --write`, which now removes every stale claim file on this
disk and not only those of a deleted branch.
