---
title: "In a repository with no commit yet, Naima names the first commit before anything else"
kind: fix
affects:
  - usage
  - workflow
---

`naima init` in a repository with no commit prints the first commit as its next step: `git add` with the tracker folder and the agent files it wrote, and the
`Naima-Setup: install` trailer the trunk guard takes, leaving the project's own files for an item of their own. `naima open` refuses with the same line until
that commit exists, instead of failing on git's "invalid reference: HEAD".
