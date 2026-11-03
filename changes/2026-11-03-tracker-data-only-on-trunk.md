---
title: On a development line, Naima writes no tracker data and no naima.json, except an item's own work
kind: behaviour-change
affects:
  - usage
  - workflow
commands:
  - changed new
  - changed note
  - changed set
  - changed event
  - changed plugin
  - changed update
  - changed gate
---

Tracker data is written only on the trunk. In a checkout of a development line, or of a branch opened from one, Naima refuses to file an item, add a note or a
description, set a field by hand, link items, write an event or an attachment, and change `naima.json` in any way, `naima gate`, `naima plugin` and
`naima update` included. Each refusal says to run the command in the trunk's checkout; the line gets the change when it syncs.

An item's own work is still written on the line, since it travels with the code: its fixed mark (`fixedOn`), its test runs (the status and last run a test or a
property records) and the session note. A change note is a file of the code and is unaffected.
