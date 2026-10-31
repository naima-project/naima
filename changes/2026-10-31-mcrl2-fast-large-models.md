---
title: "The mCRL2 verifier is fast on large generated models: verdict-preserving options with faster defaults, the compiled rewriter chosen automatically, the rate recorded, a lint on summand conditions"
kind: feature
affects:
  - api
checks:
  - added mcrl2-summand-conditions
---

`verifierOptions` of an mcrl2 property is now an allow-list: `route`, `timeoutSeconds`, `threads`, `maxStates`, and three new options that never change a
verdict. `noRewrite` (default true) linearises with `mcrl22lps --no-rewrite` on every route and is part of the LTS cache key, so existing cached state spaces
are made again once. `cached` (default true) explores with `lps2lts --cached`. `rewriter` is `auto` (default), `jitty` or `jittyc`: with `auto`, `lps2lts` uses
the compiled rewriter when the last jitty exploration of the same model on this host took longer than the last measured compile time (a generation cut short by
the time limit or the state cap counts for the time it ran), and falls back to jitty, saying why, when the mCRL2 build has no jittyc (Windows) or no C++
compiler is present. Any other key is an error naming the accepted ones.

Every run records the options it used and its rate: on the LTS route `details.lts.exploration` and `details.rate` (states per second, the compile time apart),
on the standard route `details.rate` (BES equations per second). After linearising, each summand's condition is measured with `lpspp`; the ones over the plugin
option `summandConditionLimit` (10000 operator and variable occurrences by default, 0 turns it off) are named in the run's output and its record, and the new
check `mcrl2-summand-conditions` notes the model. The guide on designing with a model now says how to keep generated models small: a priority between outputs is
one shared derived predicate, not a negated guard copied into every summand.
