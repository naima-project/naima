---
title: "The turn-end capture check no longer misses a change made in the same second as a commit"
kind: fix
affects:
  - usage
---

The capture check fingerprints the project through a copy of git's index. The copy carried the time it was made, so git trusted the size and time of a file
changed in the same second the index was written, and could take the old content: two stops in a row then gave different fingerprints, and the second asked
again to file what was already judged. The copy now keeps the index's own time, so git checks those files by content.
