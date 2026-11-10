---
title: naima set, close, note, describe, retire and attach commit their tracker writes on the trunk, and the trunk guard takes them
kind: fix
affects:
  - usage
  - workflow
---

With the tracker in the code's repository, `naima set`, `naima close`, `naima note`, `naima describe`, `naima retire` and `naima attach` run on the trunk now
commit what they wrote to the tracker data themselves, in one commit with a `Naima-Command:` trailer naming the command. The trunk guard lets such a commit
through when it changes only tracker data outside rules, waivers and `naima.json`. A commit made by hand that changes an item is still refused, and other
changes in the checkout are left as they are. On a branch nothing changes: the writes travel with its work.
