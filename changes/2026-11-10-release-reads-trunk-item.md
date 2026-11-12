---
title: naima release finds an item filed on the trunk after the branch was cut
kind: fix
affects:
  - usage
---

On a branch cut from the trunk before an item was filed there, `naima release <item>` used to say no item matches, so the claim stayed and `naima land` refused.
It now finds the item among the claim's own entries, by its id, its `<type>/<slug>` or its slug, or else reads it from the trunk. `naima land` still asks for
the trunk to be merged into the branch first, which brings the item with it.
