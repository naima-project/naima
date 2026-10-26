---
title: A property verified on a Windows checkout with core.autocrlf is current everywhere
kind: fix
affects:
  - usage
---

`naima verify` hashed each file a run reads as it was on disk, so a checkout that writes CRLF line endings recorded other hashes than one that writes LF, and
every such run looked stale elsewhere. A text file is now hashed by the content git commits, its CRLF line endings read as LF, both where a run is recorded and
where `naima check` and `naima equivalent` compare it. A binary file is hashed as it is. Runs recorded on LF checkouts keep their hashes.
