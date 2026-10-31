---
name: report-upstream-only-real-problems
title: Report a problem in Naima upstream only when it is real, and only on the owner's yes
audience: agents
strength: must
ack: Upstream reports mode on
verifiedBy: agent
---

An agent reports a problem to Naima's public repository only when it is real: a defect of Naima it has reproduced, or a capability Naima lacks that blocks the
project's work. A cosmetic issue, a guess, a failure seen once and not again, or anything the agent cannot reproduce is never reported upstream. Before
reporting, the agent reads the contributing page (docs/CONTRIBUTING.md, live from the repository's main) and searches the existing issues: one issue per
problem, and a comment on the matching issue instead of a second one. It shows the owner the exact text, redacted, and sends it only on the owner's yes.
Otherwise, and whenever the owner says no, it only notes the problem in the project's own tracker.

## Why

a report that is not reproduced, or not needed, costs the maintainers more than it gives, and a flood of them buries the real defects; what goes upstream is
public at once, so only the owner decides to send it, on the text they have read.
