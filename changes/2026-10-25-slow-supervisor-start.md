---
title: A run whose supervisor is slow to launch is starting for a minute, not lost
kind: fix
affects:
  - usage
---

On a busy machine a runtime can take tens of seconds to launch, because
macOS checks the binary before it runs. `naima run` now waits up to a minute
for the supervisor to report that the command started, and a record with no
report yet stays starting for that minute instead of turning lost after
three heartbeats.
