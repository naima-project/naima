---
title: "naima verify estimates each step's total from the previous run, so its progress shows a percentage and the time left"
kind: feature
affects:
  - usage
  - api
  - data
commands:
  - changed verify
---

The mCRL2 tools never say how many states or BES equations a step will reach, so `naima verify` used to show only a count and a rate. Now every run it records
keeps, in `counts`, the count each finished step ended on. The next run of the same property, on the same model and `verifierOptions`, shows that count as the
step's estimated total: the progress reads like `lps2lts: 1,200/~4,000 states (~30%) · ETA ~2m`, and the progress line carries `"estimate": true`. When a step
goes past its estimate, the total grows to a tenth more than the count instead of passing 100%. A first run, with no earlier count, shows the count and rate as
before. A command reporting through the plugin API can mark a total as an estimate with the fourth argument of `progress.stage(name, total, unit, estimate)`,
and a command writing `$NAIMA_RUN_PROGRESS` itself can add `"estimate": true` to its line.
