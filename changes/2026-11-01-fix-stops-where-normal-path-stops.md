---
title: "naima fix stops where the normal path stops, and takes up the branch it left"
kind: fix
affects:
  - usage
---

On the trunk, a `naima fix` whose landing was refused rolled everything back: the commit was undone and the reason was only in that run's output. It now stops
where the normal steps would. When the trunk moved since the branch was made, it merges the trunk into the branch and tries the landing once more. Any other
refusal once the worktree is open leaves the branch, the worktree, what was committed and the claim in place; a refused landing's reason is added as a note on
the item, committed on the branch, and the run says what to do next. Running `naima fix` again with the same title takes up that branch and worktree, with or
without a new change in the main checkout, and lands it.
