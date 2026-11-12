---
title: "Hosts for naima run --host can be declared privately, outside the repository"
kind: feature
affects:
  - usage
commands:
  - changed run
  - changed wait
  - changed verify
  - changed tools
---

`naima run --host`, `naima wait --host`, `naima verify --host` and the tools plugin's `--host` reached only the hosts declared in the committed `naima.json`, so
using a private machine meant committing its ssh address. Hosts can now also be declared in `hosts.json` in the user's Naima config folder (`~/.config/naima/`,
or `%APPDATA%\naima\` on Windows), in the same shape as the `hosts` option. They are added to the committed ones, a private host of the same name wins, and each
machine named there counts as a private word.
