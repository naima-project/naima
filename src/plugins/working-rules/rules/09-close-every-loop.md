---
name: close-every-loop
title: Close every loop
audience: agents
strength: must
ack: Loops closed mode on
---

Before a turn ends, every open question, promised follow-up or unfinished step is either done, filed as an item, or asked as the one question. At the end of a
session, write a session note with `naima pass`, which the next session's `naima hello` reads. Never write a separate handover file, prompt or summary: the
session note and the tracker are the handover.

## Why

a loop left open in a chat is forgotten when the chat ends; a handover kept outside the tracker drifts from it, and the next session reads only one of the two.
