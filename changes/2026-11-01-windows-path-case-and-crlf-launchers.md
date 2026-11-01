---
title: On Windows, naima check compares worktree paths ignoring letter case and accepts CRLF launchers
kind: fix
affects:
  - usage
---

On Windows, `naima check` compares a worktree's folder with the worktrees folder the way the file system does: a drive letter or a name spelled in another
letter case, or with the other slash, is the same folder, so a worktree made by `naima open` is no longer reported as outside it. With `core.autocrlf` true, the
checked-out `naima.ps1` and `naima.cmd` have CRLF line endings; `naima check` now counts them current instead of reporting the launchers missing or out of date.
`naima.sh` still has to be LF, since a POSIX shell cannot run it otherwise.
