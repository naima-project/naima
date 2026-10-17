---
title: A change to a model is proved red then green, backed by a witness, and a model can be in development
kind: feature
affects:
  - api
  - workflow
  - data
commands:
  - changed waive
  - changed land
checks:
  - added property-failed-first
  - added property-witnessed
  - added model-development
rules:
  - added A change to a model is proved, not just checked
---

A property that holds and proves a bug, a todo or a feature is expected to
have a violated run, with its counterexample, on the model before the change.
`naima check` notes it otherwise (`property-failed-first`). It is also
expected to be backed by a witness, a second property linked to it with the
new relation `witnesses`, which shows the new behaviour can happen
(`property-witnessed`). Both are notes that name the property, so either can
be waived with its reason; `naima waive` now accepts a note's subject.

A new item type, `models`, marks a model as in development by its path.
While it is, an out-of-date run of one of its properties is a note rather
than a problem, and the two checks above ask nothing of it. It becomes
`stable` only when every property verified on it holds on a run of the model
as it is now (`model-development` reports the rest). After a landing,
`naima land` lists the properties on the files it changed that are not
current, and plugins can add their own lines there through the new
`landing-reports` extension point.
