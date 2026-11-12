---
title: open names worker/<what>, a claim follows a renamed branch, the sweep can drop an orphan claim on a line
kind: fix
affects:
  - usage
---

`naima open --name <what>` now makes the branch `worker/<what>` when neither `--as` nor the coordination option `who` names who works. A claim follows a worker
branch renamed by hand with `git branch -m`: it is read as the renamed branch's, no longer as a branch that is gone. `naima stale --write` drops an orphan claim
a development line carries by a commit with a `Naima-Command:` trailer that only removes claim files, which the line's guard lets through.
