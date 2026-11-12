---
title: on Windows, the supervisor of a run is started inside a cmd, so the programs of a one-string command write to the log
kind: behaviour-change
affects:
  - usage
commands:
  - changed run
---

On Windows a run's supervisor was created through WMI, which gives it no console. The cmd it started for a command given as one string then had no console to give the programs it runs, and a program such as deno, node or where wrote nothing to the log. The supervisor is now created inside a cmd of its own, a hidden one, and has that console.
