---
title: The coordinator hands over to a fresh session when its context gets deep
kind: feature
affects:
  - api
  - usage
  - workflow
commands:
  - added handover
  - changed hello
  - changed land
  - changed push-check
---
The coordinator's context is measured at the end of every turn where the host gives a measure (Claude Code does, from the transcript). Past a share of the window, set by the coordination options `contextWindow` and `handoverAt`, the coordinator is told to run `naima handover`. The command writes the session note with the claims, the branches waiting to land, the runs and the open meeting, gives the coordinator role up and prints the text that starts the successor session. The successor's `naima hello` takes the role and resumes from the note. The session that handed over is refused by `naima land` and by the push check. In Claude Code, `naima hello` also pins the session id for later commands, so the old session can be told from its successor. The defaults for the window and the share await the owner's choice.
