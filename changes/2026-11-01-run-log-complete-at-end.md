---
title: "naima wait no longer misses a run's last lines"
kind: fix
affects:
  - usage
commands:
  - changed wait
---

A run could be recorded as ended before its last output reached its log. The command's exit can come while its output is still in the pipe, so `naima wait`
sometimes printed a log without its last line. The run's end is now recorded only after its output has closed, waiting at most two seconds in case a process the
command left behind holds the pipe open.
