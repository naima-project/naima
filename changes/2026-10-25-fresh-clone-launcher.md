---
title: A launcher run from inside a fresh clone of another project serves that project
kind: fix
affects:
  - usage
---

The skill says that in a fresh clone, with the data and no program, running the launcher of any Naima at hand from inside the project clones the locked commit
into the program. The launcher served its own project instead. Run from inside another git project whose `naima-tracker/naima-data/naima.json` exists, it now
serves that project, as `--data` would, and clones its program at the lock.

Also: `naima announce --gate` counts the features an epic on the gate groups; the `metrics` gate, with only suites' metrics and code measures declared, stands
on a record from which HEAD changed only the tracker; `naima changes` in a project with no change notes points to `naima announce`; and the basics say the
release notes come from `naima announce`, and from change notes where the project keeps them.
