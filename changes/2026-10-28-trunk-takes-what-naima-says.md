---
title: "The trunk guard takes every commit Naima tells you to make on the trunk"
kind: fix
affects:
  - usage
  - workflow
  - api
commands:
  - changed claim
  - changed release
  - changed prune
  - changed messages
  - changed waive
rules:
  - changed Every change goes through an item and lands
---

The trunk guard now takes a commit on the trunk that changes, adds or removes claims, so the
housekeeping `naima claim`, `naima claim --step`, `naima release` and `naima prune --write` do
on the trunk is committed there as they say. It also takes a note or an attachment written with
`--revised`: the signature and the attachment's record they leave in the item's `meta.json` are
fields Naima fills, declared with the new field property `filled`, and a change confined to them
is part of the addition. Every message that names a branch to commit on is now said in one
place, which says to land a write that changes more than it adds: `naima messages ack` now says
to land the acknowledgement instead of committing it anywhere.
