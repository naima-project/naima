---
title: The session greeting is one line, and hello no longer names a release that shipped
kind: fix
affects:
  - usage
  - workflow
commands:
  - changed hello
---

Under a session-start hook, `naima hello --hook` now shows the owner one line: the banner and whether anything waits on their decision. The rest goes to the
agent, which answers the owner's message instead of repeating the greeting, and every command it is told to run is written as the project runs it,
`sh naima-tracker/naima.sh <command>`, never as a bare `naima`. A release gate now counts as shipped when its version matches a tag however it is written (1.1
is v1.1.0), in the project, in the tracker's own repository or in a submodule, so `naima hello` names the next release instead.
