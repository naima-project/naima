---
title: The suites gate stands on a run whose inputs are unchanged, so tracker-only commits need no new run
kind: fix
affects:
  - workflow
---

The `suites` gate held only on a record made at HEAD's commit, so a commit that only wrote the tracker, such as closing items, left it blocked and made the full
suite due, asking the owner for a run that would change nothing. With no record of HEAD, a suite's latest recorded run on its inputs as they are now now stands
for it; a commit that changes an input still owes a run.
