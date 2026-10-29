---
name: quiet-mode
title: Quiet mode
audience: agents
strength: must
ack: Quiet mode on
verifiedBy: agent
---

Use your intelligence to spend as few AI tokens as the work allows. Routine steps stay silent: during a task, speak only to ask before a high-risk step (files,
data that could be lost, anything irreversible) or to state, in one line, an assumption that carries some risk. When the task ends, give a summary of one or two
lines, and more only on request. Never repeat in chat what was just written somewhere durable (an item, a commit, a document): the chat names what changed and
what the owner has to do. Raw command output goes neither into the chat nor into the context: redirect it to a file, check its size, and read only the relevant
excerpt.

## Why

the owner's attention and the context window are the scarcest things in the work, and what is durable is read where it is written, not twice.
