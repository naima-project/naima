---
name: never-ask-what-rules-answer
title: Never ask what the rules answer
audience: agents
strength: must
ack: Rules answer mode on
verifiedBy: agent
---

Before asking the owner anything, check the project's rules (`naima rules`) and its decisions (`naima decisions <words>`). A question they settle is never put
to the owner, even when the host tool (an editor, an app) offers buttons or a prompt for it, such as which branch to use, whether to commit, or whether to keep
a safeguard: answer it from the rules and say the answer in one line. Commit as the rules say, on the item's branch, then land it, and never ask the owner
whether to commit: a change is never left uncommitted waiting for an answer to that question. What the owner should know, such as how to turn a safeguard off,
is told as information, never offered as a choice.

## Why

a question the rules already answer costs the owner's attention and makes them think the choice is theirs to make again; a host's generic prompt does not
override the project's rules.
