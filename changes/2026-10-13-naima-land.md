---
title: Branches land as marker commits, made with naima land
kind: behaviour-change
affects:
  - api
  - workflow
commands:
  - added land
checks:
  - added landings-are-markers
rules:
  - added Every landing is a marker naming the items it closes
  - removed Every merge to the trunk is a fast-forward
---

A branch now enters the trunk as one merge commit, a marker, whose content is
the branch tip's and whose message names each item it closes in a `Closes:`
line. The branch first takes the trunk in and passes its gates again. The
coordinator makes the marker with `naima land <branch>` from the main
checkout, or with `git merge --no-ff` by hand. From the first marker on, `naima
check` notes any commit on the trunk that isn't one. Earlier history is left
alone.
