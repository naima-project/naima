---
title: naima land records its marker in the items it closes
kind: fix
affects:
  - workflow
  - data
---

Right after the marker, `naima land` makes one more commit on the trunk that
adds the marker's hash to the `commits` field of each item the marker closes,
keeping the hashes already there. `naima close` then finds a commit reachable
from the trunk, and no longer needs `naima set <item> commits=<marker>` first.
`naima check` accepts that commit as part of the landing.
