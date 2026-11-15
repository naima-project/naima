---
name: long-work-through-naima-run
title: Long work goes through naima run and naima wait; no hand-written wait loop
audience: agents
strength: must
ack: Long work mode on
enforcedBy: wait-loops
verifiedBy: wait-loops
---

A command expected to outlast a few minutes, or one run on another machine, is started with `naima run <name> --budget-time <duration> -- <command>` — with
`--budget-disk` and `--creates` when it writes stores or temporary data, `--host` when it runs elsewhere — waited on with
`naima wait <name> --timeout <duration>`, watched with `naima run list`, and cleaned with `naima run clean <name>`. A hand-written wait loop (`while` or `until`
with `sleep`) and any process lookup by pattern (`pgrep -f`, `pkill -f`) are forbidden, in a session and in a committed script. A command expected to
last more than a minute is never run in the foreground: a long foreground timeout is forbidden. A shell call is never given a tool timeout over 60 seconds
unless the command is `naima run` or `naima wait`; `naima run` returns once it has seen the command alive, and `naima wait` runs with a timeout shorter than a
minute, again as often as needed, so that a run that never started or shows no progress is seen within seconds. The agent tool's hook refuses such a call, and
the check `foreground-timeouts` fails on any found in the agents' transcripts since the last session note.

## Why

thirteen hand-written wait loops, each matching its own command line through `pgrep -f`, ran for up to 10.5 hours and were shown to the owner as work in
progress; others kept polling a remote run that had hung; a third agent filled a remote disk with stores it never cleaned. A run with a budget ends itself, a
wait by record ends when the run does, and what a run declares it creates is removed by one command.
