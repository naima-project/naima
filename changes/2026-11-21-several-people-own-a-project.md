---
title: Several people can own a project; changes record who ordered them, and a shared trunk takes each owner's landings
kind: feature
affects:
  - api
  - usage
  - workflow
  - data
commands:
  - added waiting
  - changed hello
  - changed queue
  - changed show
  - changed note
  - changed land
  - changed claim
  - changed open
  - changed new
options:
  - added plugins.coordination.options.sharedRemote
rules:
  - added Every change records the person who ordered it
  - changed No locks: the coordinator is the single writer
---

Every write of an item adds a line to its history, `history.jsonl`, with the person who ordered it (git's user.name, NAIMA_PERSON, or `--by` on any
command; `--by agent` for an agent's own change), and Naima's own tracker commits and landing markers carry an `Ordered-by:` trailer. `--asked-by owner`
records which owner asked. `naima show` prints who asked, who filed and who ordered each change; a note names the agent that wrote it for its person.
An item can name the person it waits on (`waitsOn`). `naima waiting` lists what waits on the person at the keyboard, from what the plugins contribute to
the new point `waiting`, leaving out what waits on someone else; `naima hello` counts that list, `naima queue` says its size, and the bridge serves it as
the view `waiting`. With the coordination option `sharedRemote`, `naima land` fetches, lands and pushes at once and lands again when the push is refused, and
`naima claim` and `naima open` push the claim when they make it. The UI's item page shows the authors, who ordered each change and the comments, and
adds a comment as the person at the keyboard.
