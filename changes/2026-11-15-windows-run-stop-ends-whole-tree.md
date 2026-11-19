---
title: on Windows, stopping a run ends every process it started, even those whose parent had gone
kind: behaviour-change
affects:
  - usage
commands:
  - changed run
---

On Windows `naima run stop`, a run's time budget and its disk budget ended the command with a gentle taskkill first, which cannot end a console program, and
gave up as soon as the command's cmd was gone, leaving its deno processes and a browser a hung test had started. The supervisor now ends the tree forcibly at
once, lists the run's descendants every 15 seconds and when it ends the run, and ends those still alive after the command is gone (matched by process id and
creation time, so a process that reused an id is left alone).
