---
title: A test run naima metrics run records needs no consent record
kind: fix
affects:
  - workflow
---

`naima metrics run --record` attaches each test's run as `test-run-<time>.json`, a file Naima writes itself, but the check `attachment-consent` asked it for a
record of whose it is, which blocked closing the work it proves. Such files are now among the generated ones the check passes over, beside a verifier's
`run-*.json`.
