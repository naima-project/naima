---
title: A goal has a plan, its open work as waves that run at once, with the critical path, proposed by agents and approved by the owner
kind: feature
affects:
  - api
  - usage
  - workflow
commands:
  - added plan
options:
  - added plugins.gates.options.gates.<gate>.plan
---

`naima plan <goal>` says how a goal will be reached: its open items and the open items they wait for, in waves that can run
at once within maxWorkers, the critical path (the heaviest chain, an item weighing its effort where it has one, else one
unit), and the heavy runs (suites, model checks, benchmarks, owed proofs) at the goal's checkpoint once the work is done.
The `plan` view gives the same data to the UI and to agents through MCP's `view`, with a short summary. An agent proposes or
revises a note on the plan with `naima plan <goal> --propose "<note>"` (the UI's action `plan-propose`), which clears an
approval; the owner approves it with `--approve`, from the Plan view's button (the action `plan-approve`, which MCP refuses to
agents). An approval names the plan's fingerprint, so a plan that changed since says it needs approving again. In the UI a
goal selected on the Roadmap unfolds its waves under its bar, and the Plan view of a goal opens from the Roadmap, from Goals
and from Home's goal rows.

The plan shows where it stops for the owner: an open discussion, a gesture only a person makes (`runBy` human) and each
meeting with one of them on its agenda are nodes of their own, "meeting with you", dated by the meeting's `on` or waiting;
the work after them waits behind them, and a meeting takes no worker. An item a discussion `concerns` waits for its
decision. The `checkpoints` view gives every checkpoint record and what the landings owe since the last one that passed;
the Roadmap draws them as squares under its time axis, joined to the goal they check: filled when passed, red when
failed, hollow when owed at a goal's expected end, gathered into a count where they would collide.
