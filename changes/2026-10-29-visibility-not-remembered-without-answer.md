---
title: "A visibility check with no answer is no longer remembered"
kind: fix
affects:
  - usage
commands:
  - changed check
---

When Naima could not reach GitHub to ask whether a repository is public — offline, or in a run without network permission, such as the helper the launcher
starts before each command — it remembered "unknown" for a day, so the next `naima check` kept saying it could not tell, even where GitHub would have answered.
It also renewed the date of an answer it already had, without asking. Now a run without an answer records nothing, and an "unknown" remembered by an earlier
version is asked again.
