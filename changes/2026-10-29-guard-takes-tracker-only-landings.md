---
title: "The trunk guard takes a tracker-only landing, and land reports a refusal as one"
kind: fix
affects:
  - workflow
commands:
  - changed land
---

The trunk guard now takes the marker `naima land --tracker-only "<reason>"` makes: a merge whose
`Tracker-only:` trailer says why a branch that changes only tracker data lands is a landing marker,
as one with `Closes:` or `Tracker:` is; its tree must still be the branch's, and the branch must
still contain the trunk. A merge with none of the three trailers is still refused.

When a hook refuses to move the trunk, `naima land` now says so, with the hook's own reason, instead
of reporting that the trunk moved while landing.
