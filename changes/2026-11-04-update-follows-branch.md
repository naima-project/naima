---
title: naima update --branch follows another branch of Naima's source, such as a development line
kind: feature
affects:
  - usage
---

A project can now run a development line of Naima before it is released, without losing its tracker's history: `naima update --branch <name>` moves the lock to
the head of that branch of the source and records it as `branch` in naima.json, so every later `naima update` follows that branch instead of the releases.
`--to <commit>` with it names a commit of that branch. `naima update --main` goes back to following the main.
