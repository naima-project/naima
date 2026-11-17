---
name: workers-stay-short
title: Workers stay short; past its bound a worker ends and a fresh one continues from the item and its notes
audience: agents
strength: must
verifiedBy: agent
---

A worker's length is bounded by its own context: the share `workerAt` of its own model's window. The coordinator plans work packages so that each fits well
inside that bound, splitting long work into several workers, each starting fresh from the item and its notes. A worker told at a turn end that it is past its
bound finishes the step in progress in full, writes its state into each item it claims (`naima note <item>`: what is done and committed where, what is left, the
next step), commits, runs `naima claim --at-bound` and ends, reporting that it stopped at its bound. The coordinator, seeing the claim ended at its bound in
`naima claims`, continues the item with a fresh worker in the same worktree and branch, briefed from the item, its notes and `naima recover <branch>`. A session
that does not hold the coordinator role is never addressed as the coordinator.

## Why

a long worker fills its context just as the coordinator does, and it has no handover of its own: what it learned is lost when it degrades or stops, unless it is
written where the next worker reads it. Short workers that end at a step's end, with their state in the item, lose nothing.
