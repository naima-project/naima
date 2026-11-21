---
title: Act on an item from its page in the window, and start an item now or close it as won't fix from the command line
kind: feature
affects:
  - usage
  - data
commands:
  - added start
  - changed close
  - changed note
---

The item open in Home's stage has a row of actions under its title: Start now, Move to a goal or release, Decide or Approve what it waits for, Comment
and Close as won't fix. Each runs through the bridge's action command as a run of `naima run` in the name of the person at the keyboard, one at a time,
and an action the item does not allow says why. `naima start <item>` puts an open item on the ready queue to start now, its ready record naming who
ordered it. `naima close <item> --wont-fix --reason "<why>"` writes the reason as a note and sets the item's type's status for work deliberately not
done: a bug's wontfix, a todo's or a requirement's dropped, a feature's withdrawn. These statuses carry the new status flag `declined`. What a person writes in the window, run with `NAIMA_ROLE=person`,
needs no `--revised` signature: the no-leaks checklist binds agents, and the scrub of private data still holds every write.
