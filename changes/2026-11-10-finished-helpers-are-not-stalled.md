---
title: Home tells a finished helper from a stalled one
kind: fix
affects:
  - usage
---

A helper whose items are all fixed, proven or closed is no longer called stalled on Home: Home says it finished but still holds its work, and offers
Release it. Look at it on a stalled helper opens a small view of the helper, with what it holds and its last step, and the actions Release and Open its
work. `naima release` takes `--of <branch>` to drop another branch's claim, which the window uses. The item screen no longer says Needs you when nobody is
waited for, and a description still holding the template reads No description yet.
