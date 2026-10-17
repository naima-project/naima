---
title: A refactoring of a model is proved by equivalence, with naima equivalent
kind: feature
affects:
  - api
  - workflow
  - data
commands:
  - added equivalent
---

`naima equivalent <model>` compares a model with the earlier version its
properties were verified on, found in git, modulo an equivalence the
verifier decides (`--modulo`; for mCRL2 `bisim`, the default, or
`dpbranching-bisim`, through `ltscompare`). When the two are equivalent, each
property gets a run that carries its earlier verdict over to the new version,
marked `carried` in the run record, and `naima verify` reuses it. A verifier
adapter offers this with `equivalences`, `compare` and `preserves`. An agent
that refactors a model runs `naima equivalent` instead of verifying every
property again.
