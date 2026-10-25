# What Naima tells you while you work

A session with an agent can last many hours, sometimes offline, and the
greeting Naima gives at the start of it is soon out of date. A newer Naima
may come out in the afternoon, a long run may become due, or the daily
check for updates may keep failing because the network is down. Naima tells
you about these while you work, through the agent, and never acts on them
without your yes.

## The tick

Naima runs no program in the background. Instead, every naima command
starts with a short piece of housekeeping called the tick. The tick looks
at what is due and does it:

- once a day, it asks Naima's source whether a newer version exists. The
  question has a short time limit, so a slow network never holds up the
  command. If it fails, it is asked again an hour later. If you set
  `"updates": "off"` in `naima.json`, it is never asked;
- once an hour, it looks for long runs that are due
  ([long work](long-work.md)). It never starts one.

Plugins can add jobs of their own. Whatever a job finds that you should know
becomes a message.

Many naima commands can run at the same moment, in several worktrees of the
same project, started by several agents. They don't get in each other's
way, and each job still runs once in its hour or its day. Each decision is
a small file that only one process can create, so there is nothing to lock
and nothing to clean up after a crash. These files live in your clone's git
directory (`.git/naima/tick/`), never in the repository, so they are not
committed and the repository does not grow because of them.

## Messages

A message has a level. An info or warning message, such as "a newer Naima
is available", is said once. An urgent message is said again every hour
until you acknowledge it. Today Naima raises one urgent message: when the
daily update check has failed every day for a week, because a fix or a
security update could be waiting without anyone seeing it.

An urgent message is also an item in the tracker, of the type `messages`,
so it reaches whoever works on the project next, on any machine, once the
tracker is committed. To see the messages and acknowledge one:

```sh
naima messages
naima messages ack update-check-failing-since-2026-10-18
```

Only you acknowledge a message. The agent tells you about it and leaves the
acknowledging to you. Once acknowledged, a message is not shown again, in any
worktree of your clone, and an acknowledgement cannot be taken back.

## How the messages reach you

With Claude Code, Naima installs two hooks in `.claude/settings.json`
([install](install.md#running-naima-hello-at-every-session-start)). At the
start of a session you see Naima's greeting directly. At the end of each of
the agent's turns, a small script checks whether anything can be due. When
nothing can, it starts nothing and the turn ends as usual. When something
is due, Naima runs the tick and the agent tells you what it found before it
stops. It does this at most once in a row, so it never keeps the agent
going.

With any other agent, the messages come with the output of the naima
commands the agent runs. Each one is a line on standard error that starts
with `NAIMA-MESSAGE`, followed by the message as JSON:

```text
NAIMA-MESSAGE {"id":"update-check-failing-since-2026-10-18","level":"urgent","text":"Naima has not been able to check for a newer version since 2026-10-18","ack":"naima messages ack update-check-failing-since-2026-10-18"}
```

The line in your `AGENTS.md` asks every agent to tell you what such a line
says at once. An editor or another tool can show the messages too, by
reading these lines or the JSON of `naima messages --json`. The format is in
the [reference](../reference/reference.md).

To run the tick yourself, and see at once what it finds, use `naima tick`.
