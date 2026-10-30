---
title: "The trunk guard takes the commits Naima's own setup asks for: the install, the migration of a copied program, the update that brings the guard in"
kind: fix
affects:
  - usage
commands:
  - changed guard-check
  - changed update
---

The trunk guard refused commits that Naima itself told the user to make on the trunk: the installer's first commit in sibling mode, once it held the agent's
entry file and settings beside the tracker folder, the installer's commit after moving a copied program to a git clone, and the commit of an update from an old
commit of main that brought the guard in. Each of these commands now carries a `Naima-Setup:` trailer (`install`, `migrate`, `update`), and the guard takes a
commit with it when it touches only the tracker folder, `AGENTS.md` and the files an agent tool's setup writes. An `install` commit must add the tracker, and an
`update` commit passes only while the trunk does not carry the guard yet; `naima update` asks for that trunk commit only then, and otherwise still says to land
the update through an item. A commit made by hand is refused as before.
