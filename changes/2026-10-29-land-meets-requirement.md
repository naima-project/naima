---
title: "naima land --meets lands a branch whose work meets a requirement"
kind: fix
affects:
  - workflow
commands:
  - changed land
---

A branch whose work meets a requirement had nothing to close, since a requirement is met by its test rather than closed, so `naima land` refused it.
`naima land <branch> --meets <requirement>` now lands it, with a `Meets:` trailer on the marker naming the requirement. It is refused unless a test that
verifies the requirement passed on the branch tip, had not passed on the trunk already, and nothing refutes the requirement. The trunk guard and the check that
reads the trunk take a `Meets:` marker as a landing marker; a merge with no `Closes:`, `Tracker:`, `Tracker-only:` or `Meets:` trailer is still refused.
