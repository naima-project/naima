---
title: "naima new warns, and naima check notes, an item whose description is still its type's template"
kind: fix
affects:
  - usage
---

An item filed with only a title kept its type's template as its description, placeholder sentences included, and nothing said so: a discussion went to a meeting
with no question written down. `naima new` now warns when the new item's description is still the template, and the check `template-body` notes every item that
is open, or still in the status its type starts it in (a decision is settled as it is filed), whose description is the untouched template of its type, the title
line and the Notes section aside. It is a note, so it never fails `naima check`; `naima describe` clears it.
