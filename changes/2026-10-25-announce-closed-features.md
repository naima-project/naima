---
title: naima announce lists features already closed into the archive
kind: fix
affects:
  - usage
  - workflow
---

`naima announce` used to look only at the features folder, so once a release's
features were closed with `naima close` it listed nothing, and the release
notes had to be written by hand. A feature in the closed archive, moved there
from a feature type, now counts as shipped and is announced when it is
user-facing, documented and checked. Closing keeps the fields, but a closed
item can't be changed: set `facing`, `docs` and `gate` while it is open.

`facing`, `major` and `docs` now also apply to the closed archive, so a
feature closed before they were set can still be given them.
