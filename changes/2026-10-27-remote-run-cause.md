---
title: "naima run --host says why the host's run did not start"
kind: fix
affects:
  - usage
---

When a run on a host fails to start, for instance because its program does not exist there, `naima run --host` now gives the host's own line, such as
`could not start: spawn echo ENOENT`. It says the host's Naima needs the long-work plugin only when that Naima has no `run` command.
