---
title: a goal can be closed as superseded by another
kind: feature
affects:
  - usage
---

`naima gate set <gate> --superseded-by <other> --reason "<why>" --consent "<the owner's yes, restated>"` closes a goal the owner replaces with another. The goal
holds and shows "superseded by <other>" in `naima gates`, `naima gate show` and the window; `naima hello` no longer names it, and it raises no overdue note and no
alarm. Its open items move to the other goal, said one by one, and the reason, the consent and the day are kept in `naima.json`. `--superseded-by ""` undoes it
and moves the items back. The gates data (`naima gates --json`) gains `supersededBy` on such a goal, whose `finished` is true.
