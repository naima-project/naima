---
title: "naima describe, note and attach read a file in the system's temporary folder"
kind: fix
affects:
  - usage
---

`naima describe --file`, `naima note --file` and `naima attach` refused a file kept in an agent's scratch directory, because Naima read only inside the project,
so agents copied the file into the project first and had to remember to remove the copy. These three commands may now also read the system's temporary folder
and its subfolders (`/tmp` and `TMPDIR`, or `TEMP` and `TMP` on Windows). They only read there, and what they read is checked for private data and secrets as
before.
