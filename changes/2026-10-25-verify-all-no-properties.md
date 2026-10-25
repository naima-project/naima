---
title: naima verify --all succeeds when the project has no property
kind: fix
affects:
  - usage
---

The release steps run `naima verify --all`, which printed its usage and
failed in a project with no property. It now says there is nothing to
verify and succeeds.
