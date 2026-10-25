---
title: naima land names the items to close next, and only those that close with a proof
kind: fix
affects:
  - usage
---

After a landing, `naima land` said to close each item, a release among them,
which `naima close` then refused. It now names the items that are closed
with a proof and still open, or only the prune when there are none. The
release guide says which features the release notes may name, and the docs
spell artifact one way, as the release stages do.

`naima new --dedupe` now says its list is of similar titles, which may be
the same thing or only related, since agents read related items, such as
the four operations of a calculator, as duplicates.
