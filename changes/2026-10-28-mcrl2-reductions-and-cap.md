---
title: "mCRL2's LTS route reduces each formula by an equivalence that preserves it, caps the state space, and shows exploration as it goes"
kind: behaviour-change
affects:
  - api
  - usage
---

The LTS route no longer refuses a formula: it reduces each one by the coarsest equivalence that preserves and reflects it. A formula of the fragment with no
fixpoint and no deadlock through a star is reduced modulo branching bisimilarity; one with an inevitability pattern or a deadlock through a star modulo
divergence-preserving branching bisimilarity, as before; any other formula, or one on an LTS whose labels join a hidden action to another, modulo strong
bisimilarity with nothing hidden. The run's output and `details.reduced` say which equivalence was used and why, and the reduced LTS is kept beside the LTS for
every formula that needs the same reduction. A run that began `LTS route refused:` now reaches a verdict.

`verifierOptions.maxStates` caps the states `lps2lts` explores: a larger state space makes the run `unknown`, its output beginning `state cap reached:`, and the
cut-short LTS is not cached. On the standard route the option is an error. While `lps2lts` runs, its states, search level and transitions are the run's
progress; `ltsconvert` and `lts2pbes` are started with `--verbose`, and every line any step prints is shown as progress while it runs.

The naima-codegen verifier is made for naima-codegen commit `5aca11dbb1e0`: a run records the commit of the checkout `naima-codegen` runs from, and whether it
is the pinned one, in place of a fixed text, and the `tool missing:` message says which commit to check out.
