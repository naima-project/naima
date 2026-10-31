---
title: naima issues link records that an item filed before an issue answers it
kind: feature
affects:
  - api
  - usage
commands:
  - changed issues
---

`naima issues link <number> <item>` records the address of a GitHub issue on an item that already existed for the problem, as `naima issues file` does for the
items it files: the intake then leaves the issue alone, and `naima issues` lists it with that item. The field `issue` is now one Naima fills, so the change is a
tracker addition the trunk guard takes on the trunk. An issue is recorded on one item only, and an item records one issue.
