---
title: naima land --tracker-only lands the description of an item that must stay open
kind: fix
affects:
  - usage
---

A branch opened on an item only to edit its prose, such as a discussion that waits for the owner, now lands with
`naima land <branch> --tracker-only
"<reason>"`, and the item stays open. Before, the landing treated every item the branch claimed as one it closes and refused
the open one, so the only way through was a stand-in todo. An item named with `--closes` must still be done or fixed, and a landing without `--tracker-only`
still refuses an open item.
