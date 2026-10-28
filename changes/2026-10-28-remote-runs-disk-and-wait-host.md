---
title: "Remote runs keep their disk budget, and naima wait --host waits on a run started on the host"
kind: fix
affects:
  - usage
commands:
  - changed run
  - changed wait
---

`naima run --budget-disk` and `--creates` failed on a host whose Naima runs under the launcher, because checking a declared path asked whether the home
directory exists, which the launcher does not let Naima read. Now they work there as they do locally: the path is checked, the disk budget kept and
`naima run clean` removes what the run created.

`naima wait <name> --host <host>` waits on a run started on the host itself, which has no record here, by asking the host for its record. If the host does not
know the run, `wait` says so and exits 1 at once. A run started from here with `--host` is still found without the option.
