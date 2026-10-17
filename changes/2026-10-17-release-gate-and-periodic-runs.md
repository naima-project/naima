---
title: A release gate waits for the full suite, and long suites run on a schedule
kind: feature
affects:
  - api
  - workflow
commands:
  - changed gate
  - changed run
options:
  - added plugins.gates.options.gates.<name>.fullSuite
  - added plugins.long-work.options.periodic
checks:
  - added periodic-runs
---

A gate declared with `--full-suite` (`"fullSuite": true`) is a release gate:
it holds only when every gate marked part of the full suite holds too. Those
are `properties`, which now asks every property to hold on a run of the
project as it is now, with the properties of a model in development owed
instead of blocking, and `suites`, every test suite passing on the current
commit. A plugin's gate joins the full suite with `inFullSuite`.

Long suites run on a schedule: a run declared in the long-work plugin's
`periodic` option is started by `naima run periodic` once its period has
passed, as an ordinary `naima run` with its budgets and progress. A periodic
run that ends without succeeding is filed as a bug, once, and a later failure
is a note on that bug while it is open. The check `periodic-runs` notes a
periodic run that has never run or is overdue. A project that wants these
runs has `naima run periodic` started by its scheduler or at session start.
