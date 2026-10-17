---
title: The program is a git clone of Naima, locked to a commit
kind: breaking
affects:
  - usage
  - data
options:
  - removed carry
migrations:
  - data format 2 to 3, carry leaves naima.json
action: Run naima update. It moves the lock past the old layout and migrates naima.json. If your project committed the program, naima update refuses and says the one command that removes it.
---

The copy of Naima a project runs, in `naima-tracker/naima/`, is now a git
clone of the product, ignored by the project's git. `naima.json` records the
source and the exact commit it runs, and every command first makes the clone
match that commit. Installing Naima is a plain `git clone` followed by any
command.
