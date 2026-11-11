---
title: "The mCRL2 verifier can run with the compiled rewriter, chosen for a property, a machine or a project"
kind: feature
affects:
  - usage
---

`naima verify` of an mCRL2 property can now pass `--rewriter` (`jitty`, `jittyc`, `jittyp` and so on) to every mCRL2 tool that takes one: `mcrl22lps`, `lps2lts`
and `pbessolve`. The compiled rewriter, `jittyc`, explores a large state space many times faster. It is chosen in the property's `verifierOptions.rewriter`, for
one machine in the environment variable `NAIMA_MCRL2_REWRITER` (a host sets it in the command that runs its Naima), and for the whole project in the plugin
option `rewriter` of `verifier-mcrl2`, the property's choice first and the project's last. The rewriter never changes a verdict, so it is no part of a run's
identity; the run records it in `details.rewriter`.
