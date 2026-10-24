---
title: naima open bounds the worker worktrees open at once, and coordinators pick the cheapest capable model
kind: behaviour-change
affects:
  - api
  - workflow
commands:
  - changed open
options:
  - added plugins.coordination.options.maxWorkers
---

`naima open` now refuses a new worker worktree once as many are open as the
coordination option `maxWorkers` allows, 3 by default, and the refusal names
the open ones and how to free one or raise the bound. The coordinator flow
asks for the cheapest model that can do each task, the strongest only for
diagnosis and design, and a line saying what each started worker is.
