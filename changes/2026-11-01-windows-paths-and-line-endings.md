---
title: On Windows, worktree checks, git's reasons, suite logs and file paths in reports work as on macOS and Linux
kind: fix
affects:
  - usage
---

On Windows, a command run through the launcher no longer stops asking for system access to find the home folder: it reads it from the environment. `naima check`
no longer reports a worktree made by `naima open` as outside the worktrees folder because git wrote its path with forward slashes. A suite's log written by
`naima metrics run --record` has the project's root replaced as `<root>` when a tool printed it with forward slashes. The beta markers and the docs link check
name files with forward slashes on every system. The program's files are checked out with LF line endings whatever `core.autocrlf` says, so the no-leaks
checklist it prints, and every file it reads, are the same bytes on every system.
