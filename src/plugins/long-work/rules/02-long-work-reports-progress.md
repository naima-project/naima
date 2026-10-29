---
name: long-work-reports-progress
title: Long work reports its progress, or says why it cannot and what it reports instead
audience: everyone
strength: must
ack: Progress mode on
enforcedBy: progress-declared
---

Work that can last more than a few seconds reports its progress at least every few seconds: how much is done of the total, or the stage it is in with a count,
and an estimate of the time left whenever the total is known. Where that is truly impossible — a tool with no progress interface — the work declares so, with
the reason, and reports what it can: the elapsed time, the stage, and the tool's own log lines. A run started with `naima run` writes its progress to
`$NAIMA_RUN_PROGRESS` — one JSON line such as `{"stage":"render","done":12,"total":40,"unit":"frames"}` — or is started with `--no-progress "<reason>"`; a Naima
command that can run long declares how it reports, or why it cannot.

## Why

`pbessolve` ran for more than 11 hours on each of two properties of a scheduler model, and nothing showed whether it was moving, how fast, or when it would end:
a silent run cannot be told apart from a hung one, and the only choices left are to wait blind or to kill work that was nearly done.
