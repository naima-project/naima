---
title: "naima guard server: the trunk guarded on GitHub too, on the owner's word"
kind: feature
affects:
  - usage
commands:
  - changed guard
---

When the code's origin is on GitHub, Naima tells the owner, when it installs the trunk guard and in `naima guard`, that the server can guard the trunk too.
`naima guard server` makes a GitHub branch ruleset, with the GitHub CLI, that lets only the repository's admins update, delete or force-push the trunk. It is
never made by default. Without `gh`, or with `--print`, the command sends nothing and prints the ruleset, the `gh api` and `curl` requests and the web page.
