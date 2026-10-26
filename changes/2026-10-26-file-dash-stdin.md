---
title: "--file - reads standard input"
kind: feature
affects:
  - usage
---

`naima note`, `naima describe` and `naima pass` take `--file -` to read
their text from standard input, so text an agent pipes in needs no file in
the project. Given `/dev/stdin` as a path, which the launcher's fence
refuses, Naima says to use `--file -` instead.
