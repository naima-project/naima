---
title: "A repository GitHub reports as private is private, even behind a proxy that signs requests"
kind: fix
affects:
  - usage
commands:
  - changed init
  - changed check
---

Naima asks GitHub's public API whether a project's repository is public. It used to take any successful answer as public, which is wrong behind a proxy that
signs every request with the owner's credentials, as cloud coding sandboxes do: GitHub then answers for the owner's private repository too, and `naima init`
stopped as if the tracker were about to be published. Now a successful answer counts as public only when it says the repository is public; one that says private
(or internal) is private, and one that says neither is unknown, which init asks the owner about.
