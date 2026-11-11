---
title: "A program the launcher did not grant is no longer recorded as an error of the property"
kind: fix
affects:
  - usage
---

When the launcher did not grant a program a verifier starts (a tool whose path it could not name when it started), `naima verify` recorded the refusal as the
property's `error` verdict, which stood until the property was run again. The command now stops with the refusal, says that nothing was recorded, and says to
run it again, and the property keeps the verdict it had.
