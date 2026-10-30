---
title: A hands-on test passed with nothing attached is noted
kind: feature
affects:
  - workflow
checks:
  - added passed-test-carries-evidence
---

A test an agent performs by driving the running software (`runBy:
agent-hands`) could be set to `passed` with no record of what was run. The new check
`passed-test-carries-evidence` notes such a test until its run is attached, with `naima attach <test> <file> --own`.
