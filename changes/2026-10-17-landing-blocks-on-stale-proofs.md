---
title: naima land refuses a branch whose changed files have proofs not current
kind: behaviour-change
affects:
  - api
  - workflow
commands:
  - changed land
rules:
  - changed A change to a model is proved, not just checked
action: Before landing, run naima verify and naima metrics run --record on the branch for what it changed, and commit the runs.
---

Before the trunk moves, `naima land` brings the main checkout's files to the
branch tip's and checks the proofs of what the branch changed. A property
verified on a file the branch changed, or a property the branch changed
itself, has to hold on a run of the branch's files, and a test suite that
reads a changed file has to have a passing recorded run on them. Models in
development are left out. If anything isn't current, nothing lands and the
files go back. A proof that can't be made current before landing, such as a
suite that runs for days, is landed with `--stale-proofs "<reason>"`, and
the reason is kept in the marker as a `Stale-proofs:` trailer.

For plugins, a landing report can now have `blocks(ctx, landing)`, checked
before the landing, besides `report`, printed after it. The verifier's
`properties-current` and the metrics plugin's `suites-current` are checks of
this kind.
