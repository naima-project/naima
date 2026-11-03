---
title: The window's rail reaches the whole history of the current line, down to the first commit
kind: feature
affects:
  - usage
---

The rail at the top of `naima ui` is one row of the current line's commits, as the chosen design draws it, and it now holds the line's whole history. The
`metro` bridge command sends the trunk's and each line's first-parent commits down to the root commit, up to 5000 of them; past that the root commit is
still sent and the commits between are counted in `older`. On the rail the first commit stays at the left end, the commits after it that do not fit are
folded behind their count, and opening the count draws every one of them. The open map still shows the newest stretch as a transit map.
