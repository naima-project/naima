# Messages to the owner

Naima's tick runs at the start of every naima command ([what Naima tells you while you work](../guide/messages.md)). What it finds for the owner reaches you in
one of three ways, and in each case your part is the same: tell the owner, and leave the deciding to them.

## In a command's output

After a command's own output, the tick prints each message due on standard error, one line each:

```text
NAIMA-MESSAGE {"id":"update-available-0123456789ab","level":"info","text":"A newer Naima is available: ...","ack":null}
```

- Tell the owner what `text` says, at once and in plain words, even when the command was about something else.
- `level` is `info`, `warning` or `urgent`. An urgent message comes back every hour until the owner acknowledges it; say that it is urgent.
- `ack` is the command that acknowledges the message, or null for one that is said only once. Run it only when the owner tells you to. Never acknowledge a
  message on the owner's behalf, even to stop it repeating.
- A message never asks you to act by yourself. A newer Naima is updated with `naima update` only after the owner's yes; a due long run starts only after the
  owner's yes ([long work](long-work.md)).

## At the end of your turn

With a tool that has a turn-end hook, the hook may keep you from ending a turn and tell you what to say. Say it in your reply, then end the turn. The hook does
this at most once in a row and at most once an hour for the same message, so it never keeps you going.

The same hook checks capture. When a turn changed the project's files and nothing in the tracker changed, it stops the turn once with a reminder. Judge what the
owner said since the last turn. A request, a decision, a report or a deferral that is settled is filed now, deduplicated and in your own words. Something the
owner is still thinking aloud about gets one question at the end, asking whether to file it. If nothing was settled, end the turn without mentioning it
([capture now](reporting-and-triage.md)). Committing changes nothing: it compares the files' content, with git alone, and starts no Deno.

## At the start of a session

`naima hello` lists the urgent messages after what it says about updates and long runs. With a session-start hook, the owner has already seen its one line;
answer their message and pass on, one plain line each, what waits on the owner's decision.

## Listing and acknowledging

```sh
naima messages              # what is waiting, urgent first
naima messages --json       # the same, for a tool to show
naima messages ack <id>     # only when the owner says so
```

An urgent message is an item of the type `messages`, created by the tick. Commit the tracker after the owner acknowledges one, so the acknowledgement reaches
every machine. `naima tick` runs the tick at once and prints what it finds.
