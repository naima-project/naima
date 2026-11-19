---
title: naima land finds a trunk that is not named main
kind: fix
affects:
  - usage
---

In a project with no `main` or `master` branch and no origin HEAD, the trunk is now the local branch git's `init.defaultBranch` names, else the branch the main
checkout stands on. `naima land` and the other commands that read the trunk no longer refuse with "no trunk" there.
