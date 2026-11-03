---
title: naima ui --sidecar answers the bridge commands over standard input and output, for the desktop app
kind: feature
affects:
  - usage
---

`naima ui --sidecar` answers Naima's bridge commands on its standard input and output, one JSON object a line, each answer naming its request, and pushes the
feed of the project's changes there too, with no network listener: the launcher grants it no network. It also reads a file of a tab's folder for the desktop
app's `naima-files:` scheme. It is what the desktop app's Tauri shell starts in the project's folder. The developer page The desktop app (develop/desktop.md in
Naima's workshop) describes the shell.
