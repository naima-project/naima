---
title: "The first unsigned write of free text shows the no-leaks checklist and goes on again, on the trunk and in a worktree"
kind: fix
affects:
  - usage
  - api
---

Every unsigned write of free text (`naima new`, `note`, `describe` and the others without `--revised`) failed under the launcher, because the privacy plugin
kept its mark that the checklist had been shown in the checkout's git directory, which the launcher does not let Naima write (and, for a linked worktree, not
even read). The mark is now in Naima's state folder, `naima/` in the clone's git directory, beside the tick's state, where every command may write: one file per
checkout under `checklist-shown/`, `main` for the clone's own and `worktree-<name>` for each linked worktree. The first unsigned write in a checkout prints the
checklist and goes on, signed as shown, and later ones are refused until the checklist changes; where the mark cannot be written, the write is refused with the
instructions, never with a permission error. The core API exports `stateDir(root)`, that folder.
