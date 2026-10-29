---
name: changes-land-through-items
title: Every change goes through an item, its worktree and naima land; the trunk is never committed by hand
audience: agents
strength: must
ack: Landing mode on
enforcedBy: landings-are-markers
verifiedBy: landings-are-markers
when: trunkGuard=true
---

Every change goes through an item: `naima open <item>` makes its worktree and branch, the change and its test are committed there, and `naima land` puts it on
the trunk. Never commit, merge or fast-forward the trunk by hand. Straight on the trunk only: `naima init`'s commit, the tracker additions the CLI writes (an
item filed, a note, a diary entry), and the close after a landing. The trunk guard, a git hook, refuses anything else; the owner alone lets a commit through,
with a `Trunk-reason:` trailer that says why.

## Why

an agent that was never told this made about ninety plain commits, half of them straight on the trunk, and merged a worktree it made by hand with a
fast-forward: no item said what any of it was for, no landing closed one, and nothing stopped it.
