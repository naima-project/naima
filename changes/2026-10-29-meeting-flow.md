---
title: Meetings order their agenda, close into work packages, and feed a ready queue
kind: feature
affects:
  - usage
  - workflow
  - data
commands:
  - changed meeting
  - changed decide
  - changed queue
  - changed claims
  - changed hello
---

A discussion takes a priority, a gate or milestone, and a date (`due`) like any other item. `naima meeting <meeting>` orders the agenda: what is due or has
the priority `now` first, then what blocks a release or a milestone, then the rest; a `later` or `parked` priority, or a date still to come, defers a
discussion to the end, where it stays queued. `naima decide` now works on the trunk during a meeting: the decision fields are filled by Naima, the status
`decided` is flagged `filled`, and the trunk guard accepts the commit; a follow-up is linked from the new todo. `naima meeting <meeting> --close` groups
the decisions not yet turned into work into packages, one per open item they concern, and, with `--consent`, records on each item a `ready` record, queued
or to start now (`--start`), or none (`--skip`). `naima queue --ready` lists the ready queue in the order it starts. `naima hello` and `naima claims` tell
the coordinator which ready items to start whenever a worker slot is free, and the check `ready-work-waiting` notes a slot left idle while approved work
waits. The rules on talking to the owner and on the coordinator say so.
