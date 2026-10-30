---
title: "Agents answer the owner first; filing and other work run after the answer, in the background"
kind: behaviour-change
affects:
  - workflow
rules:
  - changed Talking to the owner
  - changed Fast mode
  - changed The agent talking to the owner coordinates; workers do the work
  - changed Capture, with judgment
  - changed Agents keep the diary
  - changed Requirements are elicited at every prompt
---

When the owner asks something, the agent's first reply answers it. Filing an item, a requirement, a diary entry or a note, and any other work the question
starts, never comes before that answer and never holds it up: it runs in the background, with a worker or right after the reply, unless it truly cannot, and
then the reply says why in one line. The rules that said "file at once" now say "in the same turn, after the answer". Agents acknowledge the changed rules
again.
