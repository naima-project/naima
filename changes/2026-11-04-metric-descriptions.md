---
title: Metrics describe themselves, and the metrics screen shows the chosen one's description above its chart
kind: feature
affects:
  - api
  - usage
commands:
  - changed metrics
options:
  - added plugins.metrics.options.metrics.<name>.description
  - added plugins.metrics.options.metrics.<name>.references
---

A metric may declare a `description`, what it measures and how to read it in a few plain sentences, and `references`, one or two links to further reading,
each `{ "title": "…", "url": "https://…" }`. Every preset and every suite metric brings its own description, and the complexity and coverage presets a paper.
The metrics screen of `naima ui` shows them in a card above the chosen metric's chart, and `naima metrics` lists them under each metric.
