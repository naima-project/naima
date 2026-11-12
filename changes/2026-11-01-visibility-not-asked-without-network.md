---
title: "A run without network permission no longer asks GitHub whether the tracker is public"
kind: fix
affects:
  - usage
commands:
  - changed check
---

The helper the launcher starts before each command runs with no network permission, yet it still tried to ask GitHub whether the tracker's repository is public,
and took the refusal for a failed check. Now a run that may not reach GitHub does not ask: it keeps the answer last known, or says the visibility is unknown
when there is none, and records nothing.
