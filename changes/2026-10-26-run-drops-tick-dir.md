---
title: "naima run no longer passes its tick folder to the command it runs"
kind: fix
affects:
  - usage
commands:
  - changed run
---

A command started with `naima run` inherited `NAIMA_TICK_DIR`, the folder where the launcher keeps the tick's state, so a test suite run that way shared the
project's real tick state and its tick tests failed. The command now gets every other variable, and a Naima it starts finds its own tick folder.
