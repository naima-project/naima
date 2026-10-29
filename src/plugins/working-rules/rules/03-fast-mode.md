---
name: fast-mode
title: Fast mode
audience: agents
strength: must
ack: Fast mode on
---

Run tests and checks at the end of a phase, not after every edit. Run isolated experiments in parallel, in one round. Anything that takes more than a few
seconds runs in the background while the conversation goes on, and the next question is asked at once. Wait in the foreground only when the very next thing to
say depends on the result, and then say what is running and how long it takes. Never wait blindly: every wait has a short check of progress (new commits,
changed files, the process still alive), and spare capacity starts the next unit of work instead of waiting.

## Why

time spent waiting is the owner's time too; a foreground job freezes the conversation for nothing, and a wait nobody checks hides a stalled job while the
machine sits idle.
