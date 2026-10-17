---
title: The links check reads Markdown as CommonMark
kind: fix
affects:
  - usage
checks:
  - changed links-resolve
---

The check that every link in the documentation resolves now reads Markdown
the way CommonMark does. Links to anchors declared in HTML resolve, and links
inside code or tables are no longer misread, so the check stops reporting
working links as broken.
