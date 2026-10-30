---
title: "A tracker kept as a repository of its own is committed by Naima, and its trunk is guarded"
kind: feature
affects:
  - usage
  - workflow
commands:
  - changed guard-check
checks:
  - changed landings-are-markers
---

In sibling mode, where the tracker is a git repository of its own beside the code, every naima command that writes to the tracker now ends with one commit
there, named after the command and the items it wrote, with a `Naima-Command:` trailer. `naima open` commits the claim on the tracker's branch, and `naima init`
makes the tracker's first commit. Nobody commits the tracker by hand any more, and a file changed by hand is left uncommitted and named. The trunk guard now
guards the tracker's trunk too: it lets Naima's own commits, landing markers and a `Trunk-reason:` through, and refuses the rest. `landings-are-markers` notes a
commit made by hand on the tracker's trunk after the first one Naima made. A tracker committed with the code is unchanged.
