---
title: A file outside the project is refused in plain words, not with the runtime's flags
kind: fix
affects:
  - usage
---

The launcher runs Naima fenced to the project, its tracker and git. A command given a file outside, such as release notes to load, used to fail with the
runtime's advice to rerun with `--allow-read`, which nobody can act on. It now says the file is outside the project and to copy it in first (or, for a write, to
give a path in its tracker folder).
