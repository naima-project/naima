---
title: naima line unfix withdraws a fixed mark on a line, and a landing on a line runs the landing checks
kind: behaviour-change
affects:
  - api
  - usage
  - workflow
commands:
  - added landing-check
  - changed line
  - changed land
options:
  - added plugins.coordination.options.landingHost
checks:
  - changed landings-are-markers
---

`naima line unfix <gate> <item> --reason "<why>"` withdraws an item's fixed mark on an open development line: one marker on the line, with an `Unfixes:`
trailer, takes the item's `fixedOn` off the line's copy, the item's work stays on the line, and the line's landing on the trunk leaves the item open. A later
landing on the line fixes it again.

A landing on a line now runs the landing checks, as a landing on the trunk does, on the branch tip's files: in the branch's worktree when it is clean at the
tip, else in a checkout of the tip made for them. A failing check refuses the landing; what is not current is said, and the line's landing on the trunk asks for
it. Every landing check prints one line saying where it ran and what it found, so a pass is seen.

A landing check may declare itself heavy (`heavy: true` in its landing report). `naima land` never runs a heavy check where it runs: it sends the branch tip to
the host the coordination option `landingHost` names, runs `naima landing-check` there through `naima run --host`, waits on it and reads its findings. With no
landing host named, the landing is refused.
