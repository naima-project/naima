---
title: "naima note only adds: the lines already in an item stay byte for byte"
kind: fix
affects:
  - usage
---

`naima note` rewrote the item's whole README through its parser, so a line already there could change, a trailing space dropped for instance. A note on the
trunk was then not a pure addition, and the trunk guard refused it. The note is now appended to the file as it is.
