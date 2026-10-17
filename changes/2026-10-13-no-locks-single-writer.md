---
title: No locks, the coordinator is the single writer
kind: breaking
affects:
  - api
  - workflow
commands:
  - changed claim
  - changed release
  - changed claims
options:
  - removed plugins.coordination.options.resources
checks:
  - removed resources-one-holder
rules:
  - "added No locks: the coordinator is the single writer"
action: Nothing by hand. naima update removes plugins.coordination.options.resources if it is set. Work that used a resource claim, such as publishing the site, is handed to the coordinator.
---

Naima no longer has resource claims. `naima claim --resource`, `naima release
--resource` and `naima claims --resources` are gone, together with the
option that listed the resources. Instead one agent, the coordinator, is the
only one that lands branches on the trunk, pushes it, publishes the site and
makes releases. Workers prepare their work on their own branches, and the
owner decides what lands and when, when it matters.
