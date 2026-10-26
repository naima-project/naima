---
title: A list field takes a JSON list; a stale claim's reason says done or closed
kind: fix
affects:
  - usage
---

`naima set <item> 'testNames=["a", "b"]'` stored the whole bracketed text as
one value. A field that holds several strings now takes a JSON list too, so
a value may hold a comma; the comma-separated form still works. A claim whose
items are all done, not yet closed, was called stale because "every item it
claims is closed"; it now says "done or closed".
