---
title: Commit messages are checked for private infrastructure before a landing and a push
kind: fix
affects:
  - api
  - workflow
commands:
  - added push-check
  - changed land
rules:
  - changed No machine names or private infrastructure in a repository
action: Run naima update so the trunk guard writes its new pre-push hook and points each submodule checked out at the project's hooks.
---

A merge of another clone's branch made with a plain `git merge` from a local path writes git's default message, which names that path, a home directory with the
user name in it. `naima land` now refuses a branch whose commits carry a home path, a machine or user name, an IP address or a word of the private list in their
messages, in the project or in a submodule whose pointer it moves, unless `--allow-private "<reason>"` gives the reason. While the trunk guard is on, it also
installs a `pre-push` hook that runs the new `naima push-check` and refuses a push that would send such a commit, from the clone or from a submodule checked out
in it; `git push --no-verify` is the owner's way past it. Commits already on a remote are not read again. A product's main is merged into a branch path-free:
`git fetch <checkout> main`, then `git merge --no-ff -m "Merge product main" FETCH_HEAD`.
