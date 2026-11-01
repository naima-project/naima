---
title: "The mCRL2 summand-condition lint reads the print as a stream, takes a limit per property, and never turns a verdict into an error"
kind: fix
affects:
  - usage
---

The lint on summand conditions of the `verifier-mcrl2` plugin read the whole `lpspp --format=internal` print into one string, and a large LPS, whose print
can be hundreds of times its size, made the run an error instead of a verdict. The print is now read as a stream, and a summand's condition is counted only up
to the limit: one past it is reported as more than the limit, marked `atLeast` in `details.lint`. When the lint cannot run, the output has one line
`lint skipped: <reason>` and the property gets its verdict as before. A property can set its own `verifierOptions.summandConditionLimit`, which replaces the
plugin option for that property; 0 turns the lint off for it.
