---
title: "The mCRL2 verifier linearises with rewriting again by default; no-rewrite is a per-model choice, lps2lts and pbessolve get a larger stack, and a crash names its signal"
kind: behaviour-change
affects:
  - api
  - usage
---

Linearising without rewriting, the default since the previous release, makes `lps2lts` overflow its stack or stall for hours on some generated models, while it
is faster on others. The default is back to `mcrl22lps` as it is. To linearise without rewriting, choose it on each property of a model where it helps:
`naima set <property> 'verifierOptions={"linearise":"no-rewrite"}'` (`"rewrite"` is the default). The earlier `noRewrite` is still read: `true` is
`"no-rewrite"`, `false` is `"rewrite"`.

The choice is part of the LTS cache key and of what identifies a run, so a run under one choice is never reused for the other. A property that sets neither
option is identified as before; its runs made under the previous release, which linearised without rewriting, are taken as made under the default, since the two
linearisations give the same verdict. Every run records `details.linearise`.

On macOS and Linux, `lps2lts` and `pbessolve` start with the stack limit raised, through `/bin/sh`, which the verifier now declares among the programs it runs.
A tool killed by a signal is an error whose output says `<tool> crashed (signal N, NAME) on <model>`, never a plain exit of -1. Verifier adapters may declare
`identityOptions(options)`, the options as they identify a run.
