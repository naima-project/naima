---
title: Every change of behaviour carries a change note, and an update is studied and rehearsed before it is applied
kind: feature
affects:
  - api
  - usage
  - workflow
commands:
  - added changes
  - changed land
  - changed update
  - changed hello
checks:
  - added change-notes
rules:
  - added Every change of behaviour carries a change note
---

A repository with `changes/config.json` lists there the paths whose change alters behaviour, and a branch that changes one adds a change note under `changes/`.
`naima land` refuses a branch without one, unless `--no-change-note "<reason>"` says why none is needed, and `naima check` notes it on the branch beforehand.
`naima changes` assembles release notes from the notes.

`naima update --check`, and `naima hello` when `updates` is `update`, now show the change notes of a newer Naima, breaking changes first, and rehearse it: they
run the newer Naima's own `naima check` on the project, from a temporary copy, and say what would newly fail or be noted. `naima update` renames and removes
options in `naima.json` as the notes say, removes the options the newer Naima reads nowhere, and is finished by the newer Naima itself. It names the rules
agents should acknowledge again, runs `naima check`, and files a todo for each new finding it could not fix. A project's todo type carries the trait `follow-up`
for this.
