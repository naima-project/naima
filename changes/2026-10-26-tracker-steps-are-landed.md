---
title: "Tracker steps that change more than they add are landed, even with one agent; naima init's commit is accepted on the trunk"
kind: behaviour-change
affects:
  - usage
  - workflow
commands:
  - changed update
  - changed waive
checks:
  - changed landings-are-markers
rules:
  - changed Every landing is a marker naming the items it closes
---

An update of Naima, a waiver, a release record and an epic set done each get
an item of their own, are made in its worktree and are landed with naima land,
also in a project worked by one agent. naima update and naima waive now say so
in the line that tells you what to commit. The check landings-are-markers
accepts the commit naima init makes, the one that adds naima.json, as it
already accepts the close after a landing.
