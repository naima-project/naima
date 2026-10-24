---
title: A tracker can be kept private, in a repository of its own beside public code
kind: feature
affects:
  - api
  - usage
  - workflow
commands:
  - changed init
  - changed land
  - changed open
  - changed prune
  - changed hooks
checks:
  - added landings-paired
  - added branches-paired
rules:
  - added Public commits name nothing of a private tracker
---

`naima init` now decides where the tracker lives. A project with no remote,
or a private one, keeps it inside as before. When the remote is public, or
its visibility can't be told, init stops and asks, through the agent, whether
to keep the tracker private beside the code: `--private-tracker` makes
`naima-tracker/naima-data/` a git repository of its own, created on this
machine with no remote and ignored by the code; `--tracker <url>` clones an
existing one; `--tracker-inside` commits it with the code anyway. The
installer takes the answer as `NAIMA_TRACKER=private|inside|<url>`.

In this sibling mode the two repositories stay linked without a submodule:
every commit names the other repository's commit in a `Tracker:` or `Code:`
trailer, added by a commit-msg hook in both; branches pair by name, and any
naima command moves the tracker to the code's branch; `naima open` makes both
worktrees and names the branch `<who>/<random>`; `naima land` lands both
trunks, the code's marker naming only the tracker commit; `naima land
<branch> --repair` finishes a landing that moved one side only, which
`landings-paired` reports. `naima prune --branch` removes both sides. A
public clone builds and tests without the tracker, and `naima` says how to
get it.
