---
title: Every item records its origin, and a session can be reviewed
kind: feature
affects:
  - api
  - usage
  - workflow
  - data
commands:
  - changed new
  - changed list
  - changed hello
  - added origin
  - added confirm
---

Every new item records its origin in the field `origin`, written once and never changed: who asked for it and in what role (`owner`, `coordinator`,
`worker`, `agent`, a `person` by name, or `unknown`), who filed it and in what role, the session it was filed in, the moment, the branch and the item it was
derived from. `naima new` takes `--asked-by <role>` (default `agent`), `--by <who>` and `--from <item>`. `naima hello` starts a session and gives it an id, or
records the agent tool's own (`--session <id>`, or the id the tool's session-start hook is given); every write in the session is logged outside the
repository. `naima origin <session>` lists what a session filed and what else it changed, `naima list --origin <role|session|date range>` selects by origin,
and `naima origin --backfill` gives older items an origin inferred from git, with `askedBy` unknown. A requirement not asked by the owner starts `proposed`:
no gate counts it and `naima check` notes it until `naima confirm <requirement> --words "<the owner's yes, restated>"` makes it stated. The field is
optional, so no migration is needed. The skill tells agents to pass `--asked-by owner` only for what the owner said.
