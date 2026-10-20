---
title: Commands Naima starts no longer inherit the launcher's mark, so a test suite passes under naima run
kind: fix
affects:
  - usage
commands:
  - changed run
---

The launcher tells the program it was launched through an environment
variable. The program used to pass it on to every command it started, so a
command run with naima run, a test suite for example, behaved as if it had
been launched too. Six tests of Naima's own suite failed that way. The
program now reads the mark and removes it, and what it starts sees an
ordinary environment.
