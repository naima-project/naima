---
title: The program's move to the lock is said as such, and a held worktree says its program runs another commit
kind: fix
affects:
  - usage
---

When the program is checked out at the commit `naima.json` locks, Naima now says `the program moved to the locked commit, <a> → <b>; naima.json is unchanged`,
where it used to say `locked commit moved`, which read as if the lock itself had changed. Only `naima update` moves the lock. In a worktree whose program
Naima holds (a link, or a lock other than the trunk's), every command other than hello and the long ones now says in one line which commit the program runs
and which one the lock names, then runs.
