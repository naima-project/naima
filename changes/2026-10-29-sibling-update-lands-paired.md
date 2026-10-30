---
title: In sibling mode, an update of Naima lands as one paired landing
kind: fix
affects:
  - usage
  - workflow
commands:
  - changed update
  - changed rollback
---

When the tracker is a repository of its own, an update changes two repositories: the lock in the tracker and the files of the code it rewrites, such as the
agents' settings and the pointer line. Run on the code's trunk, it used to commit the lock straight on the tracker's trunk, while the guard refused the code's
half there, so the two halves landed apart. Now `naima update` and `naima rollback`, run on the code's trunk while the trunk guard runs there, refuse before
anything moves and say what to do: open an item, run the update in its worktree, where Naima commits the tracker's half on the paired branch, commit the code's
half on the same branch, and land it with `naima land`. Anywhere else the tracker is first moved to the branch that pairs with the code's, and the update's last
line says what Naima commits and what is left to commit, instead of a `git add` of the tracker folder that the code's repository ignores.
