---
title: Nothing runs unattended; a long run that is due is reported and filed, never started on a schedule
kind: breaking
affects:
  - api
  - usage
  - workflow
commands:
  - removed run periodic
  - added run due
  - changed run
  - changed hello
  - changed summary
options:
  - removed plugins.long-work.options.periodic
  - added plugins.long-work.options.longRuns
checks:
  - removed periodic-runs
rules:
  - added Nothing runs unattended
  - changed A proof is current, and evidence against it wins
  - changed Test suites are recorded test by test, at the end of a phase
action: "Remove any scheduler entry that calls naima run periodic, and declare the long runs in plugins.long-work.options.longRuns."
---

Naima no longer starts work on a schedule. `naima run periodic`, the long-work plugin's `periodic` option, the check `periodic-runs` and the bug filed when a
periodic run failed are gone, and `naima update` removes a `periodic` option it finds. A run nobody watches competes with the rest of the work on the same
machine, so the owner or the coordinator starts long runs, in view.

A long run is now something Naima reports. The full suite is one, named `full-suite`, whenever some gate is part of it; others are declared in the long-work
plugin's `longRuns` option, each with its command, its time budget and what makes it due: `within`, how long since its last success it may go; `fullSuite`,
`gates`, `model` or `items`, what it covers. It is due when something it covers is no longer current, or when it hasn't succeeded within its threshold.
`naima hello` and `naima summary` say each due run in one line, and `naima run <name>` starts a declared one with its budgets once the owner says yes. A summary
section marked `hello: true` is what `naima hello` prints.

`naima run due` files each due run as a todo marked by the field `dueRun`, one per run, linked to the items it covers that aren't current, and marks it done
once the run is current. A todo was chosen over a type of its own: a due run is a piece of work waiting for the owner's go, which is what a todo is, so it shows
on the board and in the queue, is ranked and closed like any other, and a project learns no new type. The field is what keeps it to one todo per run and lets
Naima close it.

The release gate (`--full-suite`) and the landing's refusal of stale proofs are unchanged.

The pointer line `naima init` writes, and the skill, now say to run `naima hello` at the start of every session unless its output is already in the conversation
because a session-start hook ran it; then the agent passes that output on and doesn't run it again. `naima update` rewrites an earlier pointer line in place.
