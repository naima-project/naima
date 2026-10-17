---
title: naima verify reuses a result it already has
kind: feature
affects:
  - api
  - usage
commands:
  - changed verify
---

When a property already has a run that holds or is violated, made on the same
inputs, the same tool version and the same options, `naima verify` takes that
result instead of starting the tool again. It says `reused` and names the
run. A run that ended in an error is never reused. To run the tool anyway,
give the reason with `naima verify <property> --force "<reason>"`, and the
reason is kept with the new run. Two runs made in the same instant no longer
overwrite each other.
