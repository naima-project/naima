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

The coordinator's context is measured at the end of every turn where the host gives a measure (Claude Code does, from the transcript). Past a share of the
window, set by the coordination options `contextWindow` and `handoverAt` (default 0.6), the coordinator is told to start handing over. It does not hand over at
once: it finishes the work in progress, runs `naima handover --decisions`, which asks it, holding the whole conversation, to review every request of the owner
since the last session note against the tracker, file what is missing and record the review signed against the no-leaks checklist (`--reviewed`), nothing being
judged by word matching, proposes the handover to the owner with `--propose`, refused until a review is recorded after the owner's last message (what is saved,
that nothing is lost, how the new chat continues), and the owner may postpone it (`--postpone`). Once the owner agrees, `naima handover --agreed` keeps a
private copy of the session's transcript in the project's state folder (never committed) and writes the session note with the claims, the branches waiting to
land, the runs and the open meeting, gives the coordinator role up and prints the text that starts the successor session. The successor's `naima hello` takes
the role and resumes from the note. The session that handed over is refused by `naima land` and by the push check. In Claude Code, `naima hello` also pins the
session id for later commands, so the old session can be told from its successor. The successor's `naima hello` points to the predecessor's conversation, and
`naima handover --read` prints excerpts of it. `naima handover` and `naima recover` may read the tool's transcript folders. The window and share defaults are
the owner's choice.
