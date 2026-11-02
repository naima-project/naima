---
title: The new interface has its metrics screen, with key-number cards and a large chart that follow the moment shown
kind: feature
affects:
  - usage
  - configuration
---

The Metrics screen of the new interface shows the key numbers as cards, each with its value, its change, the date of its record and a small chart, and below
them a large chart with the list of every metric. Every number is the one of the moment shown: live, or a commit of the past, where a card says whether that
commit has its own record or which record holds then, and the charts mark the commit with an amber line. A metric becomes a card with `"card": true` and is
listed under a heading with `"group"`. `/data/metrics` gives each record's place on the trunk in its `timeline`, and with `?at=<commit>` each metric's record at
that commit. The guide page The Naima window (docs/guide/the-window.md) describes it.
