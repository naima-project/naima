---
title: Long work reports its progress
kind: feature
affects:
  - api
  - workflow
checks:
  - added progress-declared
rules:
  - added Long work reports its progress, or says why it cannot and what it reports instead
---

A run started with `naima run` writes a progress line, and `naima wait` and `naima run list` show how far it is, how fast it goes and when it should end. A run
that cannot report progress is started with `--no-progress "<reason>"`, and `naima run list` marks a run whose progress has stopped as stale. A Naima command
that can run long says how it reports progress, or why it cannot.
