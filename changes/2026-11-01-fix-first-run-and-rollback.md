---
title: "naima fix runs on the coordinator's first try and leaves nothing behind when it stops"
kind: fix
affects:
  - usage
---

On the trunk, `naima fix` asked for `--as` even when an agent ran it, and a run that stopped midway left a branch that made the next run refuse. Run by an agent
on the trunk, it now names the branch `coordinator/<what>` when neither `--as` nor the coordination plugin's `who` option says otherwise, and when it cannot
tell who runs it, it asks for `--as` before writing anything. A run that stops once its worktree is open, a refused landing included, rolls back: the change
goes back to the main checkout uncommitted, and its branch, worktree and claim are removed. Running `naima fix` again with the same title reuses the item the
stopped run filed.
