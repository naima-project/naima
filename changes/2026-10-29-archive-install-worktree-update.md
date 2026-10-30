---
title: "A program installed from a release archive updates in an item's worktree"
kind: fix
affects:
  - usage
commands:
  - changed update
  - changed open
---

A program installed from a release archive had no branch of its own, so the clone an item's worktree takes of it knew none of the source's commits as its
origin's. An update in that worktree moved the program to a commit it held but no ref of `origin` reached, and from then on every run refused it as holding
commits of its own, to be published as a fork. A worktree's clone now takes the seed's view of the source's branches, a fetched commit is always recorded as the
source's, and the installer gives the program a branch `main` as a clone has. A clone already left in that state recovers on its next run: when a repository on
this disk knows its commit as the source's, or the source's `main` reaches it, Naima records it and says so in one line. Nothing to do.
