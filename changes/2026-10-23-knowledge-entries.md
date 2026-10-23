---
title: Knowledge entries keep facts, findings, hypotheses and lessons with their basis
kind: feature
affects:
  - api
  - usage
  - workflow
commands:
  - added knowledge
options:
  - added plugins.knowledge.options.kinds
  - added plugins.knowledge.options.lessonsCodified
checks:
  - added knowledge-basis
  - added knowledge-kinds
---

A new item type, `knowledge`, keeps one statement the project knows, with
its `basis` (`given` with `givenBy`, `evidence`, or `derived`) and its `kind`
(`fact`, `hypothesis`, `finding`, `lesson`, or one the project declares under
the knowledge plugin's `kinds` option with the sections and fields it
requires). Evidence is linked `supports` or `contradicts`, a derivation
`derives-from`, and the rule or test that holds a lesson `codifies`.
`naima check` fails on an established entry with nothing behind it and on an
entry missing what its kind requires. `naima knowledge` prints the
established entries by kind with what each one rests on.
