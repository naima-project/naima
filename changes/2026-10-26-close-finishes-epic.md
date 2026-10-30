---
title: A close that finishes an epic is accepted on the trunk
kind: fix
affects:
  - workflow
---

Closing an epic's last items makes its status follow them, and the check on epics asks for that status in the same change, so the close commit changed the
epic's status too, and `landings-are-markers` noted it. A commit that only closes items, sets the status of a group they finish (an epic) and adds new records
beside them is now accepted on the trunk without a note.
