---
title: "Naima confirms every run started, and reports stuck, crashed and not-advancing runs within seconds"
kind: feature
affects:
  - usage
commands:
  - changed run
  - changed wait
  - changed claims
---

`naima run` now returns only once the command is seen running; a command that never starts (a program not found, a supervisor that died, a host that cannot be
reached) makes it exit 1 with the reason within a few seconds. A run is now stuck when it writes no output at all, neither log nor progress, for its `--stale`
window, which defaults to one minute for every run; `naima wait` returns as soon as a run is stuck. A run whose log grows while its progress does not move is
shown as not advancing, a warning. A run whose supervisor is gone with no end recorded is shown as crashed within seconds. The states `stale` and `lost` are now
named `stuck` and `crashed`, in the JSON too, and `naima claims` lists the runs not yet over.
