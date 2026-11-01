---
title: On Windows, naima check accepts a worktrees option written as an 8.3 short name
kind: fix
affects:
  - usage
---

On Windows, when the coordination option `worktrees` names the worktrees folder by an 8.3 short name (such as `C:\PROJEC~1\project-worktrees`), `naima check` no
longer reports every worktree made by `naima open` as outside it. The program may now read that folder by the name the option gives as well as by its real one,
so the option resolves to the folder it names.
