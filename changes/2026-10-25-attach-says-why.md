---
title: naima attach says why a file cannot be attached
kind: fix
affects:
  - usage
---

`naima attach` used to answer "is not a file" for a file that does not
exist, a folder, and a file outside the project alike. It now says which:
the file does not exist, is not a plain file, or cannot be read because
Naima reads only inside the project, in which case the file is copied into
the project first.
