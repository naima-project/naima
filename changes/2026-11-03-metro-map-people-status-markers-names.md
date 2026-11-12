---
title: The window's map shows the project's people, each worker's status from its records, where every checkout stands, and the names you give commits
kind: feature
affects:
  - usage
---

The open map of `naima ui` now draws the people of the project under their own names instead of one figure labelled You: whoever is checked out where the window
is served, on that branch, and every other author of the commits drawn, on the route of their newest commit. A pin marks the commit the main checkout and each
worktree stand on, with its name and branch. `naima name-stop <commit> "<name>"` gives a commit a name of your own, kept in the tracker's `stops/` folder and
shown under its station; the window can run it as the action `name-stop`, and `--clear` removes the name.

A worker's status on the map is no longer guessed from the words of its posted step. It is derived from the records of its branch (its claim and step time, its
commits, the runs started from its worktree, the discussions open on what it claims, and the silences between them) by a state machine generated from a checked
mCRL2 model. `naima run` now records the branch a run was started on, and `naima run list --json` and `run status --json` show it as `branch`. The `metro`
bridge command sends `people`, `checkouts` and `names` beside the map.
