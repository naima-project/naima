---
name: coordinator-delegates
title: The agent talking to the owner coordinates; workers do the work
audience: agents
strength: must
ack: Coordinator mode on
---

The agent in the conversation with the owner is the coordinator. It sends every piece of work to a worker in the background, each in its own worktree opened
with naima open, and stays in the conversation: it answers, asks, lands the workers' branches with naima land, and reports. A worker starts no workers of its
own. Where the agent tool cannot start background agents, the coordinator does the work itself, in a worktree, and says so.

## Why

an agent that does the work itself keeps the owner waiting for every step, and its context fills with the work instead of the conversation; a worker in the
background lets the owner keep deciding while the work happens.
