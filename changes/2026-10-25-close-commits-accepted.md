---
title: A commit that only closes items is no longer noted as missing a landing marker
kind: fix
affects:
  - workflow
---

`naima close`, run on the trunk once a landing's proof is checked, moves each item whole to the closed archive. The check `landings-are-markers` now accepts
such a commit without a note, as it already accepted commits that only add to the tracker data; a commit that also changes anything else keeps its note.
