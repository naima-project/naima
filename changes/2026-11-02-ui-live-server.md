---
title: The window follows the project live, reads any commit, and runs a few commands
kind: feature
affects:
  - usage
---

The server behind `naima ui` now sends an event on `/events` when the project changes (a new commit, a branch moved, a tracker file written), and the window's
home screen reads its data again while it shows Live; a commit of the past never moves. Any view's data can be read as a commit had it,
`/data/<view>?at=<commit>`, read only from that commit's tree; a commit git does not know or no branch reaches is refused. `/data/metro` gives what the rail's
map will draw: the trunk, the lines and the branches with their commits, each worker branch with a status and the reason for it, and the goals ahead in goal
order. `POST /action/<name>` runs `decide`, `note`, `gate step`, `claim` or `release` through the command line, refused without the token, this run's CSRF value
and the server's own Origin. `naima gates --json` now also gives each gate's version, due date, freeze, after, the goals ordered before it and whether it is
finished. The guide page The Naima window (docs/guide/the-window.md) describes it.
