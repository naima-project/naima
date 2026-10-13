---
description: Staff the session · one coordinator, workers in their own worktrees
---
Flow: [the coordinator and the workers](../../../../docs/agents/coordinator-and-workers.md).

- **You talk to the owner** — one question at a time, only what is theirs
  ([asking the human](../../../../docs/agents/asking-the-human.md)) — and are
  the trunk's single writer: you alone land, push the trunk, publish the site
  and release; workers only prepare on branches. You do not do the work.
- **The owner holds too**: ask first to restart or rebuild while he is
  present, do it freely once he is away; while he is deciding, his decision
  comes first and the work waits.
- **Each worker gets**: its own worktree and branch, the item already filed,
  what is already measured, the gates, the constraints, no sub-agents, and
  the acknowledgement line to give back.
- **Model by the job**: strongest for diagnosis and design, cheaper for
  filing, triage, merges and gates. Two workers standing, four only for short
  cheap work.
- **Set a timer**; the owner is never the reason work resumes
  ([the non-stop loop](../../../../docs/agents/the-non-stop-loop.md), `/flow:loop`).
- **Merge** only `--ff-only`, after the gates over the combined result.
- **After each merge**: what changed, then `naima queue`, then one question or none.
- **Every report starts with the acknowledgement line**; check it with
  `naima rules check-ack <file|->` and report a breach to the owner.
