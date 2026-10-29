---
title: naima hello says how many workers may run at once
kind: feature
affects:
  - usage
commands:
  - changed hello
---

`naima hello` now says in one line, among its offers, how many workers may run at once, the coordination option `maxWorkers`, and that the owner can ask to change it, for example "Up to 3 workers at once (maxWorkers); ask to change it." The coordinator passes the line on, so the owner knows the bound without looking it up.
