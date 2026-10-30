---
title: Test suites are recorded test by test, and performance requirements are metrics
kind: feature
affects:
  - api
  - usage
  - workflow
  - data
commands:
  - changed metrics
options:
  - added plugins.metrics.options.suites
checks:
  - added test-suites
  - added metric-satisfies
  - added performance-requirement-has-metric
rules:
  - added Test suites are recorded test by test, at the end of a phase
  - added Performance requirements are metrics with budgets
---

A project declares its test suites beside its metrics, in the metrics plugin's `suites` option, with presets for Deno, Node, Bun, pytest and cargo.
`naima metrics run --record` runs each suite once, or reuses a recorded run whose inputs are unchanged, and keeps every test's result under `test-runs/`. Test
items that name their tests in `testNames` take their status from the recorded run. The new `suites` gate holds when the record of the current commit names a
passing run for every suite. A requirement that names a time, a size, a memory or a rate is noted until a metric with a budget satisfies it
(`performance-requirement-has-metric`).
