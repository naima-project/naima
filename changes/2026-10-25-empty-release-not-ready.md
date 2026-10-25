---
title: A release gate with nothing on it does not hold
kind: behaviour-change
affects:
  - usage
---

A gate with a version and no item on it held vacuously, so a release just
declared already read as ready. Such a gate now does not hold, and says why
and how to fill it: `naima gate add <gate> <item>...`. A gate without a
version still holds when nothing is on it.
