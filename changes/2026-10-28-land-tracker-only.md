---
title: "Tracker-only branches land with a reason, reviews and decisions close with one, and the trunk never holds a claim"
kind: fix
affects:
  - usage
  - workflow
commands:
  - changed land
  - changed close
  - changed claim
  - changed prune
  - changed check
---

A branch that changes nothing but tracker data, such as the notes and decisions of a review, can
now land without inventing an item to close: `naima land <branch> --tracker-only "<reason>"` makes
the usual marker, with a `Tracker-only:` trailer in place of `Closes:`, and refuses the branch if it
changes any file outside the tracker data. The check that reads the trunk accepts such a marker.

A todo whose work is a review or a decision, once done or dropped, closes with `naima close <item>
--reason "<why>"`, without a fix, a proof or a commit. The reason is kept on the closed item, and
`naima check` lists each one as a note.

`naima claim` refuses to run on the trunk, where a claim would be copied to every branch. A claim
naming the trunk, written by an older program, is now stale: it no longer refuses `naima close`,
and `naima prune --write` removes it.

The model-first rule no longer repeats a sentence in its reason.
