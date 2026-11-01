---
title: "naima update follows a tag the source moved, and a failing git command reports git's reason"
kind: fix
affects:
  - workflow
---

A program clone that still held a tag the source had since moved to another commit (a rewritten history) could not update: git refused the tag ("would clobber
existing tag") and Naima reported only "git failed". Every fetch into the program now forces the source's refs and tags, since the clone mirrors the source, so
such a clone updates with no manual `git fetch --force --tags`. Releases are still verified by their archive's checksum, the commit it records and that commit's
files, never by a tag in the clone. Whenever a git command Naima runs fails, the error carries git's own reason: the lines git marked as failures, else its last
lines, with the home folder written `~`, else its exit status.

`naima open` no longer fails when the clone it copies a worktree's program from already holds the lock's ref, `refs/remotes/origin/naima-locked`: the seed's refs
and the locked commit are fetched in two steps, since git refuses one fetch that writes the same ref twice.
