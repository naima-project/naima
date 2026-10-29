---
title: Committed launchers in the tracker folder repair a missing Deno or program, and every hook runs Naima through them
kind: feature
affects:
  - usage
  - workflow
commands:
  - changed init
  - changed update
  - changed check
action: Run naima update once, and commit what it writes (naima-tracker/naima.sh, naima.ps1, naima.cmd, the .gitignore line, the hooks and the entry file's line).
---

`naima init` and `naima update` now write three launchers into the tracker folder, committed with the project: `naima.sh` for macOS and Linux, and
`naima.ps1` with `naima.cmd` for Windows. The session-start hook, the other agent hooks, the git hooks and the line in the entry file all run Naima through
them, as `sh naima-tracker/naima.sh <command>` (`naima-tracker\naima.cmd <command>` on Windows). When Deno and the program are there, a launcher just runs
Naima. In a fresh clone on a new machine, such as a new cloud session, it first installs Deno, pinned by version and checksum, into the gitignored
`naima-tracker/.bin/`, and restores the program from the locked release, checked against the lock's checksum, saying each repair in one line on standard
error. `naima check` notes a launcher that is missing or was changed by hand.
