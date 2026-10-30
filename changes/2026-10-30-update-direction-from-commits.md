---
title: "Moving the lock says the direction the commits take: forward, back, or the same commit"
kind: fix
affects:
  - usage
commands:
  - changed update
  - changed rollback
---

`naima update --main` in a project locked to a release whose commit is also the head of the source's main used to say it rolled Naima back, and proposed a commit named "Roll Naima back to …", though nothing went back. The direction is now computed from the commits themselves: when the lock stays on the same commit, the update says that only the lock's form changes, from the release to a commit of the source's main (or the other way), lists no commits, and proposes the commit "Lock Naima to …". A move forward still says "Update Naima to …" and a move back "Roll Naima back to …".
