---
title: The new interface has a state explorer, at /#explorer and as a file that opens from the disk
kind: feature
affects:
  - usage
---

The new interface comes with a state explorer: every state of each of its state machines, each shown by the real
interface with a recorded summary, the transitions out of it that you can take one by one, the shortest path to it from
the start, and a grid with every state at once. It needs no server: it is at `/#explorer` in the window and in
`ui/dist/explorer.html`, a single file that opens from the disk. Its count of the shell's states is the model's. The
guide page The Naima window (docs/guide/the-window.md) describes it.
