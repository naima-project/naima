---
title: Every piece of work has a planned, an expected and an actual schedule, with drift, overlaps and prediction quality
kind: feature
affects:
  - usage
  - api
commands:
  - added schedule
---

A new plugin, schedule, gives every piece of work three schedules. The actual one is read from the claims, the posted steps, the commits on the claiming branch,
the landings and the closes, with stalls after the option `stallAfter` minutes without a sign of life and pauses while the claim is gone; nobody enters it. The
planned one is recorded by `naima schedule plan` (dates given) or `naima schedule propose` (from the project's pace), one new file per plan in the tracker's
`schedules/` folder, with who proposed it; the first plan stays as the baseline. The expected one is Naima's forecast, with a confidence drawn from how past
plans of the same kind of work turned out.

`naima view schedule` and `naima schedule` show each piece's schedules and drift, the overlaps by dependency and by capacity (the over-allocated days of the
resource histogram, against the option `capacity`, by default the coordination option `maxWorkers`), and the prediction quality per kind of work and month by
month. Their data, typed in `src/plugins/schedule/types.ts`, is also the read-only view `schedule` of the new interface's bridge, which its Gantt reads. The
guide page is [Planned, expected and actual schedules](../docs/guide/schedules.md).
