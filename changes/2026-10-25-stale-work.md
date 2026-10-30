---
title: naima stale lists the work left behind, with the next step for each
kind: feature
affects:
  - api
  - usage
  - workflow
commands:
  - added stale
options:
  - added plugins.coordination.options.staleAfter
checks:
  - added claims-on-closed-items
---

`naima stale` lists every branch, worktree and claim a worker left behind: those whose claim is stale, and those with no commit, step, session note or
uncommitted change for `staleAfter` hours, a new coordination option that defaults to 24. Each entry shows its worktree, last commit, files not committed,
commits the trunk lacks, whether it is up to date with the trunk, and the items its claim holds with their status, then suggests resume, land, archive or drop
with the command to run. `naima summary` has a new "stale work" section with one line per entry. `naima check` now notes a live claim that still names an item
already closed.
