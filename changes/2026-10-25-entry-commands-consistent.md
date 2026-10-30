---
title: plugin, hello and tick answer --help; plugin set takes --revised and refuses private names; the diary tells what a session did
kind: fix
affects:
  - usage
---

The commands the entry point runs itself, `plugin`, `hello` and `tick`, answer `--help` like every other command. `naima plugin set` accepts `--revised`, as
every write may, and checks the values it writes into `naima.json` for private infrastructure, refusing a home-directory path or a machine name unless
`--allow-private "<reason>"` is given. The timeline and `naima diary` show what a session note says the session did, rather than the acknowledgement line it
begins with.
