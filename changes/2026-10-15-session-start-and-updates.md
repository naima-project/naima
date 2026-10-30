---
title: Sessions start with naima hello, and updates can be checked, chosen and rolled back
kind: feature
affects:
  - api
  - usage
  - workflow
commands:
  - added hello
  - added rollback
  - changed update
options:
  - added updates
checks:
  - added unread-options
---

At the start of a session an agent runs `naima hello`, which says that Naima is active, its version and commit, whether a newer Naima exists, and what you can
ask for. The `updates` setting in `naima.json`, set with `naima update
--mode`, says how much it looks for updates. `naima update --check` says what an update
would change, `naima update --to <commit>` moves to a chosen commit, and `naima rollback` goes back to the previous lock. When the program's copy is damaged,
Naima repairs it without losing anyone's work and says what it did. `naima check` notes an option in `naima.json` that nothing reads.
