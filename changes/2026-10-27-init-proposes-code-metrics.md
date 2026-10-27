---
title: "naima init declares the code-quality metrics that fit the project's languages"
kind: feature
affects:
  - usage
  - data
options:
  - changed plugins.metrics.options.metrics
---

`naima init` now declares the built-in `code.*` metrics that fit the languages of the project's files, with no bounds, and `deno.lint` when the project has a
`deno.json`, so a new project records its quality from the first commit. `naima update` does the same, once, for a project that has never declared any metrics.
Both say so in one line. To remove them, delete them from `plugins.metrics.options.metrics` and leave it as `{}`, which is never filled again.
