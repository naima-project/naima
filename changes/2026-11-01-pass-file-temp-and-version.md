---
title: "naima pass --file reads the system's temporary folder, and naima --version prints the version"
kind: fix
affects:
  - usage
---

`naima pass --file` refused a session note kept in an agent's scratch directory, which `naima describe --file`, `naima note --file` and `naima attach`
accept: `pass` may now read the system's temporary folder too, and only read it. `naima --version` was an unknown command: it now prints the banner
`naima hello` opens with, the running Naima's version and commit, and so does `naima version`.
