---
title: naima pass refuses a note without --ack when the rules ask for one
kind: behaviour
affects:
  - usage
  - workflow
---

A session note written without `--ack` used to be accepted and then flagged
by `naima check`, and a note cannot be rewritten. `naima pass` now refuses
it at once when the project's active rules ask for an acknowledgement, and
says which phrases. In a project whose rules ask for none, `naima check` no
longer asks a note for an acknowledgement line. The flows and guides show
`--ack "<line>"`, the last line of `naima rules --audience agents`.
