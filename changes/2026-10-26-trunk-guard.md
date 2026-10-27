---
title: "The trunk is guarded: a commit, merge or fast-forward of it made by hand is refused, and work lands through naima open and naima land"
kind: behaviour-change
affects:
  - usage
  - workflow
  - api
commands:
  - added guard
  - added guard-check
  - changed init
  - changed update
  - changed hello
  - changed hooks
options:
  - added plugins.coordination.options.trunkGuard
checks:
  - changed landings-are-markers
rules:
  - added Every change goes through an item and lands
action: "Commit naima-tracker/naima-data/hooks/reference-transaction, which naima update writes, with the update; tell the owner the trunk is guarded now, and, as information rather than a question, that naima guard off turns it off for committing by hand or a mixed flow."
---

naima init and naima update write a git hook, the trunk guard, into the
data directory's hooks and point core.hooksPath at them where it is unset.
It refuses a commit, merge or fast-forward of the trunk made by hand, in one
line that says to open an item and land it, and lets through what
landings-are-markers accepts: a marker, the record land makes, a commit that
only adds to the tracker data or only closes items, naima init's commit, a
commit that only switches the guard, and a pull of what origin's trunk
holds. The owner lets one commit through with a Trunk-reason: trailer, which
the check notes with its reason. While the guard is on, landings-are-markers
also asks from the commit that put the hook on the trunk, never before it.
The coordination plugin ships the rule that every change goes through an
item and lands, acknowledged as "Landing mode on". naima guard off turns the
guard off for the project, recorded as trunkGuard false; naima hello then
says so. A fresh clone gets core.hooksPath on its first launched run, and
naima hello now tells the agent to read the project's rules before any work.
Plugins can put things in place at init and update through the new setup
point.
