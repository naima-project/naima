---
title: Stale work nothing needs is dropped by itself
kind: feature
affects:
  - usage
---

`naima hello`, `naima land` and `naima claims` now sweep the stale work: a merged branch with its clean worktree, in the project and in Naima's own clone, a landed
branch whose worktree holds only a leftover claim file, a worktree git reports prunable, and a claim whose branch is gone are dropped without asking, a claim a
development line carries by a commit on that line. Everything else is named with its next step. `naima stale --write` does the same by hand, and `naima stale`
without it says what would go.
