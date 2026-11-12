---
title: The window's metrics screen selects a commit from a chart point, opens its run's record, and records the metrics
kind: feature
affects:
  - usage
  - api
---

On the metrics screen of `naima ui`, clicking a point of the large chart, or pressing Enter on the one the arrow keys are on, selects that commit for the whole
window and opens below the chart the record of the run that measured it: the value and whether it kept its bound, when it was recorded, and how it was taken, a
test suite's run with its counts, its time and the end of its log, or the earlier run it reused. When the newest commits have no record, the main action Record
metrics runs `naima metrics run --record` under `naima run`, with a budget of two hours, and says how the run goes until it ends. The bridge gives a view its
parameters with `data`'s `query`, and the metrics plugin adds the view metric-run, which answers the record of a point. Nothing needs to be done.
