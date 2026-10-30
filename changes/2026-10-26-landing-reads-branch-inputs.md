---
title: The landing check reads a suite's inputs at the branch tip
kind: fix
affects:
  - workflow
---

`naima land` checked that a suite reading what the landing changed has a passing recorded run on its inputs, but read those inputs from the trunk's checkout,
where the branch's changes are not yet, so it refused a branch that had its passing run. It now reads them at the branch tip. A commit that closes items and
adds a new record beside them, such as a metrics record, is accepted on the trunk like a plain close. A suite whose report cannot be read from the command's
output now says to name `report` when the command writes one to a file, and the guide says a `run` of your own drops the preset's `report`.
