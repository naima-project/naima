---
title: naima hello no longer names a release already tagged as the next one
kind: fix
affects:
  - usage
---

After a release was tagged, `naima hello` still said "Next release" for it.
A release gate whose version names a tag in git (`v1.0` or `1.0`) is now
behind the project, and hello names the next release instead, or none.
