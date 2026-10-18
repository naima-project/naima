---
description: Start a piece of work · item, worktree, claim
argument-hint: <what-you-are-doing> [item ...]
---
Flow: [opening a worktree](../../../../docs/agents/opening-a-worktree.md). Where
this checklist and the page disagree, the page wins.

1. **The work has an item.** If not: `naima new <type> "<what happened>"`,
   then triage it.
2. **Its own worktree, branch and claim, one command:**
   `naima open <item>... --as <who> --name $1 --note "why"` — the worktree
   `<worktrees-dir>/$1` on `<who>/$1` from the trunk, the claim written in it.
   `cd` there; install dependencies.
3. **Commit the claim with the work.** More items: `naima claim <item>...`,
   from inside the worktree. A worktree off the scheme, or with commits and
   no claim, fails `naima check`.
4. **Post your step as you go:** `naima claim --step "<what I am doing now>"`
   at every change of step and every few minutes during long work, which runs
   through `naima run`. The coordinator reads it with `naima claims`; a claim
   silent past `silentAfter` minutes is flagged possibly stuck.
5. **A scratchpad is not a tracker.** Defects, tasks and verifications are items.

Never write into another checkout, and never commit on the trunk:
[worktree isolation](../../../../docs/agents/worktree-isolation.md).
