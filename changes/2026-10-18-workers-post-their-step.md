---
title: Workers post their current step with naima claim --step, and a claim silent too long is flagged possibly stuck
kind: feature
affects:
  - api
  - workflow
commands:
  - changed claim
  - changed claims
  - changed summary
options:
  - added plugins.coordination.options.silentAfter
rules:
  - added Workers post their current step
---

A worker now says what it is doing while it works: `naima claim --step
"<what>"` writes the step into the branch's claim, with the time it was
posted, replacing the previous one. It works without items once the branch
holds a claim, and needs no commit, since claims are read from every
worktree's disk.

`naima claims`, its `--json` output, the claims panel of `naima ui` and the
"in hand" section of `naima summary` show each step and how many minutes ago
it was posted. A claim whose last sign of life, the later of its step and its
branch's last commit, is older than the coordination option `silentAfter`
(15 minutes by default) is marked "silent for N min — possibly stuck".

The coordination plugin ships a rule for agents: workers post their step at
every change of step and every few minutes during long work, and the
coordinator reads `naima claims` every few minutes, says what each worker is
doing when asked, and reports a silent one as possibly stuck.
