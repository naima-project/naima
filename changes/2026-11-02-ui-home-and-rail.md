---
title: The new interface has its home screen and its rail, a metro map of the project's lines with the goals ahead
kind: feature
affects:
  - usage
---

The window's rail is now a metro map: a thin strip with every commit and the future of the line checked out here, its three nearest goals labelled, that opens
over the page into the whole map of main, the open lines and the branches, each going on dashed past its tip with its goals and steps ahead, robots on the
worker branches with their status, and you on your line. Choosing a commit shows every screen as it was then, choosing a goal shows that goal, and Escape or
"Back to live" returns to live; the arrow keys step through the commits. Home shows what waits for the owner, the next goals with their progress and steps, what
is fixed and waits for proof, the open lines and who is working, read from the views' data at the moment shown. `naima queue --json` prints the queue as JSON,
and the window's views now include the queue and the lines. A change that comes while a screen is still reading its data is no longer lost. The guide page The
Naima window (docs/guide/the-window.md) describes it.
