---
name: agents-keep-the-diary
title: "Agents keep the diary: one entry per decision taken with the owner or notable turn, never a log of routine work"
audience: agents
strength: must
ack: Diary mode on
enforcedBy: diary-entries
---

An agent adds a diary entry on its own, without being asked (`naima event <today> "<what, and why>" --kind diary`), when a decision is taken with the owner in
conversation (what was decided and why, in a sentence or two, naming the item it concerns), when the direction of the work changes (a plan dropped, a strategy
chosen), or when something notable happens outside the tracker (an incident, a repository made private, a request from outside the project). It writes none for
routine work, landings, items filed, fixes or test runs, and none for what a session note, a decision item or the timeline already records, since `naima diary`
shows those already. A day holds a few entries at most: the related turns of one conversation make one entry, written once that exchange has settled, never one
entry per turn and never a second entry that repeats the first.

## Why

the diary is where the owner reads why the project went where it did; a decision taken in chat and never written down has to be reconstructed later, and a diary
that logs every landing buries the few turns that matter under what the timeline already shows.
