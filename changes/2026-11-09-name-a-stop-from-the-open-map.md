---
title: The window names a commit from the open map
kind: feature
affects:
  - usage
---

With a commit chosen and the map open, `naima ui` shows a field under the map holding that commit's name. Type a name and press Name, or empty the field
and press Remove name: the window runs `naima name-stop` for you, follows the run until it ends, says whether the name was kept, and reads the map again, so
the name appears under the commit's station.
