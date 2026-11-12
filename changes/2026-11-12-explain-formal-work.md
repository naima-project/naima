---
title: "Formal work is explained in words: a property's sentence and glosses, a model's comments, a refinement's record"
kind: feature
affects:
  - usage
  - workflow
commands:
  - added explain
  - added refine
checks:
  - added explained-formal-work
---

A property now records `says`, one sentence stating what must hold and of what, and `glosses`, each part of its formula by its exact text paired with a plain
phrase, in reading order; `naima explain <property> --says "..." --gloss "<part>=<phrase>"` sets them and refuses a part that is not in the formula. A
refinement between two models is a `refinements` item, recorded with `naima refine <lower> <upper> --relation "..." --says "..."`, with the actions hidden or
renamed. The Specs views serve both, and the UI shows them in place of the text it makes up from the formula. With the mCRL2 verifier on, the check
`explained-formal-work` notes every property without its sentence or a gloss for each modality and fixpoint, every model file without its opening comment
(with a paragraph beginning "Leaves out") or a comment on each declaration, and every refinement a naima-codegen `MANIFEST.json` relates without its record;
the plugin's option `explained` set to `problem` makes them problems.
