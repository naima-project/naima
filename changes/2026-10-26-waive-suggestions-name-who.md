---
title: The waive commands Naima suggests name who waives
kind: fix
affects:
  - usage
---

Where a finding suggests accepting it with `naima waive`, the command it gave lacked `--as <who>`, which `naima waive` requires, so it was refused as given.
Every such suggestion now carries `--as <who>`.
