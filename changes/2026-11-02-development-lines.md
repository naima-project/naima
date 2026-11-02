---
title: Development lines, one long-lived branch per goal, opened, synced, landed and abandoned by Naima
kind: feature
affects:
  - usage
---

`naima line new <gate>` starts `line/<gate>` from the trunk for one goal. An item's branch opens from its line (`naima open --line`, the chat's line set with
`naima line use`, or the open line of the item's gate) and lands back on it with `naima land`, closing nothing; `naima line sync` merges the trunk into the
line; `naima land line/<gate>` lands the line on the trunk, closing every item fixed on it, once the goals before its own are finished and its gate holds on its
tip; `naima line abandon` keeps its commits under `archive/line/<gate>`. Gates take `after`, which adds to the order by version and due date, and `freeze`
(`naima gate set --after`, `--freeze`): while a goal is frozen, no landing on the trunk closes a feature. The trunk guard also guards `line/*` and refuses a
hand merge that brings a line's work onto the trunk before the line lands, and `naima hello` lists the open lines. See docs/guide/lines.md.
