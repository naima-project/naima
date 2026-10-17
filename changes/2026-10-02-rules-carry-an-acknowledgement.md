---
title: A rule can ask agents to acknowledge it
kind: feature
affects:
  - workflow
  - api
commands:
  - changed pass
---

A rule can carry an acknowledgement phrase. An agent reads the active rules
at the start of its work and gives the phrases back in its session note,
with `naima pass --ack "<line>"`, which refuses a line that misses one of them.
