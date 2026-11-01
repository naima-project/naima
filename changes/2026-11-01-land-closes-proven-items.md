---
title: naima land closes the items it lands that are fixed and proven; naima check fails on one left open
kind: behaviour-change
affects:
  - usage
  - workflow
commands:
  - changed land
checks:
  - changed proven-but-open
  - added fixed-waiting-for-proof
rules:
  - changed Fixed, resolved and closed are three states
action: "run naima check on the trunk: each item it reports as fixed and proven, and still open, is closed with naima close <item>"
---

`naima land` now closes, through `naima close` and every check it makes, each item it names that is fixed and whose proof has passed. It does so in one commit
on the trunk right after the marker and its record, and the trunk guard takes that commit. An item that is fixed and whose proof has not passed yet stays open,
and the landing says it is waiting for its proof. The later landing that marks that proof passed closes it, because a landing also closes every fixed item whose
proof it changed. Its last line no longer suggests `naima close`.

`naima check` now fails (`proven-but-open`) on an item that is fixed and proven, one of whose commits is on the trunk, and that is still open. Before its
landing such an item stays a note. A new note, `fixed-waiting-for-proof`, lists each item that is fixed and whose linked proof has not passed, and `naima hello`
says how many of each there are.
