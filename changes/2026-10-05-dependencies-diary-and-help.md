---
title: Dependencies decide the order of work, a diary tells the story, and every command has --help
kind: feature
affects:
  - api
  - usage
commands:
  - added ready
  - added order
  - added diary
checks:
  - added dependencies-acyclic
---

`naima ready` lists the work nothing blocks any more, and `naima order` puts
the open work in the order its dependencies allow. A cycle of dependencies is
reported by `naima check`. `naima diary` tells what happened, day by day, from
the session notes. Every command answers `--help` with its usage, options and
examples.
