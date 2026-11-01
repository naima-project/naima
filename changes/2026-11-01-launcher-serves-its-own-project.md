---
title: A launcher run by its path from inside another project serves its own project
kind: fix
affects:
  - usage
---

A launcher run by its path from inside another git project that uses Naima,
`sh ../naima-dev/naima-tracker/naima.sh hello` for instance, served the tracker
of the current folder instead of its own. It now serves the other project only
while that project has no program yet (a fresh clone or a new worktree, whose
program it clones at the lock); a project that has its program is served by its
own launcher, wherever it is run from. The launchers' files did not change.
