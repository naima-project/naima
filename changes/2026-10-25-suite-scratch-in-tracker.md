---
title: A test suite's report goes in the tracker folder, so naima metrics run works under the launcher
kind: fix
affects:
  - usage
---

A suite's `{tmp}` was a folder in the system's temporary directory, which the
launcher does not let Naima write, so `naima metrics run --record` failed on
every suite in a real project. It is now `.tmp/` in the tracker folder, which
git ignores, and it is emptied after each run. Errors met while measuring
are said in plain words too.
