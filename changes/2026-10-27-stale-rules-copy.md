---
title: "A copy of naima rules kept at the repository's root is noted once it is out of date"
kind: fix
affects:
  - usage
  - workflow
checks:
  - changed rules
---

Some projects keep the output of `naima rules` in a file that their agent tool imports, and after an update of Naima that ships new rules the copy still listed
the old ones, so an agent reading it judged the new ones did not apply. The check `rules` now notes a markdown file at the repository's root whose first line
is the heading `naima rules` prints and whose content no longer matches it, with the command that writes it again; `naima update` files that note as an item.
