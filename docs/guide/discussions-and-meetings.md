# Discussions and meetings

Some questions can't be settled with a quick yes or no. A name for a new idea, the shape of a workflow, or a choice between two designs needs time with you.
Naima keeps each of these as a discussion, and gathers discussions into meetings, so that when you sit down with an agent it starts with what is waiting for
you.

| Word           | What it is                                                                                  | Made with                                |
| -------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **discussion** | a question that needs time with a person: the question, the options, and later the decision | `naima new discussions "<topic>"`        |
| **meeting**    | a gate whose agenda is the discussions on it; it holds once every one is decided            | `naima meeting new <name> "<title>"`     |
| **decision**   | what a discussion settled, recorded on it                                                   | `naima decide <discussion> "<decision>"` |
| **package**    | the work the decisions of a meeting call for, one per item they concern                     | `naima meeting <name> --close`           |
| **ready queue** | the work you approved, which the coordinator starts on its own when a worker is free       | `naima queue --ready`                    |

## File a discussion

```sh
naima new discussions "What to call authored expertise sets"
naima link discussions/what-call-authored-expertise-sets concerns features/authored-expertise-sets
```

The page of a discussion has room for the question, the options seen so far, and what to read before talking about it. The `concerns` link ties it to the items
it is about, so you can find the discussion from them as well.

A discussion is triaged like any other item. It can have a priority, a gate or milestone it blocks, and a date:

```sh
naima set discussions/what-call-authored-expertise-sets priority=now
naima set discussions/what-call-authored-expertise-sets gate=owner,release-1.1
naima set discussions/meeting-time due=2026-11-10
```

To defer a discussion, give it the priority `later` (or `parked`), or a date still to come. It stays on the agenda, at the end, and comes back to the front on
its date.

## Put it on a meeting's agenda

```sh
naima meeting new owner "With the owner"
naima meeting add owner discussions/what-call-authored-expertise-sets
```

A meeting names who it needs. Without `--needs`, that is you, the owner. By default a meeting takes place whenever the people it needs are present, so it comes
up the next time you start a session. Give it a date with `--on YYYY-MM-DD` and it comes up from that day on instead.

```sh
naima meeting new review "Design review" --needs owner,reviewer --on 2026-11-03
```

`naima meeting` shows every agenda, in the order the meeting takes it: first what is due or has the priority `now`, then what blocks a release or a milestone
(the soonest first), then the rest, and last what is deferred. Decided discussions come at the end.

```text
owner — With the owner (needs owner; whenever owner is present): 3 open of 4
  due or urgent now:
  1. ✗ discussions/meeting-time  When a meeting takes place  [due 2026-11-10]
  blocks a release or a milestone:
  2. ✗ discussions/what-call-authored-expertise-sets  What to call authored expertise sets  (about features/authored-expertise-sets)  [blocks release-1.1 (2026-12-01)]
  deferred: a later priority, or a date to come:
  - ✗ discussions/plugin-icons  Whether plugins get icons  [priority later]
  ✓ discussions/meeting-flow  How a meeting runs: Run it while the agent waits
```

A meeting is also a gate, so `naima gates` lists it with the discussions still open, and it holds once each one is decided.

## At the start of a session

`naima hello` names each meeting that has discussions to take and is due, which means any meeting without a date, and a dated one from its date on:

```text
Meeting owner (With the owner) has 2 discussions to take (1 more deferred): when owner is here, open with its agenda, in its order — naima meeting owner — one question per message, each answer recorded at once (naima decide), no work started until it closes; owner decides when to stop, and what is left stays queued.
```

The agent then opens with that agenda, one question per message. It records each answer as soon as you give it, and starts no work while the meeting is on.
You decide when to stop. Whatever you didn't get to stays on the agenda for the next meeting.

## Record the decision

```sh
naima decide discussions/what-call-authored-expertise-sets "Call them playbooks"
```

This records the decision and the day on the discussion, and marks it decided. A discussion can't be marked decided without its decision. The agent can do
this on the main branch during the meeting: the trunk guard accepts it, because deciding changes only what Naima fills in.

A decision often calls for work. The agent files that work only after you say yes, and records your yes with it:

```sh
naima decide discussions/meeting-time "Whenever the owner is present" --follow-up "Say the agenda at session start" --consent "yes, file it"
```

The follow-up is a todo, linked to the discussion with `concerns`.

## Close the meeting

When you stop, the agent closes the meeting. Naima groups the decisions you just made into work packages, one for each open item they concern, and proposes
them:

```text
$ naima meeting owner --close
Closing owner — With the owner: 3 decisions become work in 2 packages.
  1. features/authored-expertise-sets  Authored expertise sets  → queue (the default)
       discussions/what-call-authored-expertise-sets: Call them playbooks
  2. bugs/export-alpha  Export drops the alpha channel  → queue (the default)
       discussions/export-format: Keep PNG, add the alpha channel
Ask the owner about each package, one per message: queue it (the default) or start it now. Then record the answers:
  naima meeting owner --close --consent "<their yes, restated>" [--start <item>,...] [--skip <item>,...]
```

The agent asks you about each package in turn. Queueing it is the default. You can also have it started now, or leave it for later. Then it records your
answers:

```sh
naima meeting owner --close --consent "yes; start the export fix now" --start bugs/export-alpha
```

Nothing is written until you have said yes. Each package's item gets a `ready` record: the day, the meeting, the decisions it carries, your yes, and whether
to start it now. Each decision is marked as turned into work, so the next close doesn't propose it again. A decision that concerns no open item is kept as it
is. If it calls for work, file that work, link it to the discussion with `concerns`, and close again.

## The ready queue

```sh
naima queue --ready
```

This lists the work you approved, in the order it starts: what you said to start now first, then by priority. Naima feeds itself from this queue. Whenever
fewer workers are running than the coordination option `maxWorkers` allows, the coordinator starts the next item with a worker, without asking you, and
`naima hello` and `naima claims` say which one to start. It starts nothing while a meeting with you is going on. `naima check` notes a worker slot left idle
while approved work waits.

## Where to read more

The commands, fields and the `meetings` option are in [the reference](../reference/reference.md), under the discussions plugin. Gates in general are in
[Plan with epics, milestones and gates](plan-with-epics-milestones-and-gates.md).
