---
title: "Agents report a problem in Naima upstream only when it is real, and only on the owner's yes"
kind: feature
affects:
  - usage
  - workflow
---

A new working rule, `report-upstream-only-real-problems`, acknowledged as "Upstream reports mode on", is listed by `naima rules --audience agents` in every
project: an agent reports to Naima's public repository only a defect it has reproduced or a missing capability that blocks the project's work, searches the
existing issues first and comments rather than duplicates, and sends the exact redacted text only on the owner's yes; anything else is noted in the project's
own tracker. The contributing page states the same threshold. A project that does not want it retires it with the rules plugin's `retire` option.
