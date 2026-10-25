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
- **Cheapest capable model per task**: a smaller model for mechanical or
  read-only work (filing, triage, merges, searches, gates, edits already
  decided); the strongest only for diagnosis and design. Never the strongest
  for all. Say in one line each what you started: worker, branch, model, why.
- **Two workers standing, three at most** (`naima open` refuses beyond the
  coordination option `maxWorkers`, 3 by default); group related small items
  into one worker with `naima open <item> <item>`.
- **Set a timer**; the owner is never the reason work resumes
  ([the non-stop loop](../../../../docs/agents/the-non-stop-loop.md), `/flow:loop`).
- **Land** only with `naima land <branch>` (or its by-hand equivalent), on a
  branch the trunk is an ancestor of, after the gates over the combined
  result; each landing closes at least one item. `naima check` is the authority.
- **Work left behind**: `naima stale` at the start of every session and
  before ending one; each entry names its next step (resume, land, archive,
  drop) and the command; a worktree with uncommitted files is never discarded.
- **After each landing**: what changed, then `naima queue`, then one question or none.
- **Every report starts with the acknowledgement line**; check it with
  `naima rules check-ack <file|->` and report a breach to the owner.
