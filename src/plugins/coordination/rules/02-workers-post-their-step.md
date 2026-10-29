---
name: workers-post-their-step
title: Workers post their current step; the coordinator reads them and reports a silent worker
audience: agents
strength: must
---

A worker posts what it is doing now with `naima claim --step "<what>"` at every change of step, and at least every few minutes during long work, which it runs
through `naima run` so that its progress is visible too. The coordinator reads `naima claims` at least every few minutes while workers run, says what each one
is doing when the owner asks, and reports a worker flagged "silent for N min — possibly stuck" (no step and no commit for longer than the coordination option
`silentAfter`) as possibly stuck, after checking its run and its worktree.

## Why

a worker that reports only when it finishes is indistinguishable, until then, from one that is stuck: a worker eight minutes into the full test suite looked
hung, because nothing it did was visible to the coordinator or the owner.
