---
title: Agents keep the diary, elicit requirements at every prompt, and design behaviour with states from a model
kind: feature
affects:
  - workflow
options:
  - added plugins.coordination.options.diaryPerDay
checks:
  - added diary-entries
rules:
  - added Agents keep the diary
  - added Requirements are elicited at every prompt
  - added Behaviour with states is designed from a model first
---

Three rules ship with Naima. Agents add a diary entry for each decision taken
with the owner, each change of direction and each notable event outside the
tracker, and none for routine work; `diary-entries` notes a day with more
entries than `diaryPerDay` (5 by default) and an entry that only repeats a
session note or a decision. At every prompt of the owner, agents check
whether a requirement was added or changed and file it with how it will be
checked or measured. Behaviour with states or concurrency is designed from a
model first, with its properties as items; the new guide page "Design with a
model" shows a state machine written in mCRL2. Agents acknowledge the new
rules after updating.
