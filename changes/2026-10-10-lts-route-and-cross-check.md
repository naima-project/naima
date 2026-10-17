---
title: The mCRL2 verifier can check a property on a reduced state space
kind: feature
affects:
  - usage
---

A property can choose how the mCRL2 verifier checks it, with
`verifierOptions.route`. The usual route, `lps`, is unchanged. The `lts` route
builds the state space once per version of the model, hides the actions the
formula doesn't mention, reduces what is left and checks the formula on it.
It accepts only formulas that this reduction keeps true or false, and refuses
the others. `cross-check` runs both routes and gives a verdict only when they
agree. The result records the route, the sizes and the tools' versions.
