---
title: Artifacts, a type for what the work makes and keeps
kind: feature
affects:
  - api
  - usage
  - data
commands:
  - changed diary
checks:
  - added artifacts-current
---

A new type, `artifacts`, tracks something the work makes and keeps, such as an analysis, a profile, a report, a dataset or a figure. It has a `due` date, the
`files` it consists of (paths from the project root, or its attachments) and the `inputs` it is made from, and its status goes from `planned` and `in-progress`
to `delivered` or `superseded`. A todo or a feature that makes it is linked with `produces`, the tests, properties or other artifacts whose data it uses with
`uses`, and a newer version with `supersedes`. `naima set <artifact> status=delivered` refuses while a named file is missing or there is none, and otherwise
records `madeFrom` (the commit, one digest over the inputs and the items it uses, the moment) and `deliveredOn`. `naima diary` shows the delivery on that day.
The new check `artifacts-current` notes an artifact past its due date and not delivered, a delivered one whose inputs changed since it was made, and a planned
one that nothing produces.
