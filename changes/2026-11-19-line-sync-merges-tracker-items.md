---
title: naima line sync merges tracker items field by field
kind: feature
affects:
  - usage
---

An item changed on both the trunk and a line no longer stops the sync at a conflict. Its fields are merged one by one (a field changed on one side is taken, one
changed alike on both stays), its notes from both sides are kept in date order, and a description changed on one side is taken. Only a field or description
changed differently on both sides is reported, with the value each side holds, and left for a person to settle.
