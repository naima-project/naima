---
title: The LTS route explains a violation from the reduced state space
kind: behaviour-change
affects:
  - usage
---

When the mCRL2 verifier's LTS route finds that a property does not hold, it
now explains the violation with the evidence of the reduced state space it
has just solved, instead of solving the property again on the full one. The
counterexample shows hidden actions as `tau`, and the result says which
actions those stand for.
