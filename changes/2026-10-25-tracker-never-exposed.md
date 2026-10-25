---
title: The tracker is never exposed, and a tracker inside a public repository moves out with one command
kind: breaking
affects:
  - api
  - usage
  - workflow
  - data
commands:
  - changed init
checks:
  - added tracker-private
options:
  - added privateRemotes
rules:
  - added The tracker is never exposed
action: Run naima check. If it reports tracker-private, tell the owner, then run the fix it names; for a tracker committed in a public repository that is naima init --private-tracker, and then do the sweep todo it files. If Naima says it cannot tell whether a remote is public, ask the owner once and record a yes with naima init --remote-private.
---

Every write to the tracker is now refused while the tracker is exposed:
committed in a repository whose origin is public, or kept in a repository of
its own that has a public remote. The refusal says what to tell the owner and
the command that fixes it. Reading is never refused, and `naima check`
reports the same problem as `tracker-private`, so `naima update` files it as
a todo in a project where it is new.

Naima asks GitHub whether a remote is public at most once a day, and
remembers the answer in the tracker repository's git configuration, which is
never committed. The launcher now lets every command reach `api.github.com`
for this, not only `init`. When GitHub doesn't answer, the last known answer
stands and the write goes ahead. A remote whose visibility can't be told is
not a refusal: Naima asks the owner once, and `naima init --remote-private`
records a yes in `naima.json` as `privateRemotes`, by a hash of the address.

`naima init --private-tracker` on a project whose tracker is committed with
the code now moves it into a repository of its own, with its history, in
place; the code stops tracking it in one commit and nothing is deleted. It
then files a todo at the highest priority to sweep the tracker for private,
strategic and confidential information. `init` in a public project no longer
offers to commit the tracker with the code, and `--tracker-inside` now
answers only a remote whose visibility can't be told.
