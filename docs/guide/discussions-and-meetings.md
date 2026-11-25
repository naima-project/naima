# Discussions and meetings

Some questions can't be settled with a quick yes or no. A name for a new idea, the shape of a workflow, or a choice between two designs needs time with you.
Naima keeps each of these as a discussion, and gathers discussions into meetings, so that when you sit down with an agent it starts with what is waiting for
you.

| Word            | What it is                                                                                                                          | Made with                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **discussion**  | a question that needs time with a person: the question, the options, and later the decision                                         | `naima new discussions "<topic>"`        |
| **meeting**     | a gate whose agenda is the discussions on it, and anything else that waits for you; it holds once every discussion on it is decided | `naima meeting new <name> "<title>"`     |
| **decision**    | what a discussion settled, recorded on it                                                                                           | `naima decide <discussion> "<decision>"` |
| **package**     | the work the decisions of a meeting call for, one per item they concern                                                             | `naima meeting <name> --close`           |
| **ready queue** | the work you approved, which the coordinator starts on its own when a worker is free                                                | `naima queue --ready`                    |

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

Anything else that waits for you can go on a meeting too: a question on a feature, an approval, a landing waiting for your yes. `naima meeting add` puts it
there, and the agenda lists it after the discussions. Such an item is on one meeting at a time:

```sh
naima meeting add review features/export-formats
naima meeting move owner features/export-formats    # to another meeting
naima meeting off features/export-formats           # off every meeting: it still needs you
```

Each of these is noted on the item, so its page says where it went and when. A meeting's date can be set, changed or cleared at any time:

```sh
naima meeting date review 2026-11-20
naima meeting date review none                     # no date: it waits for you to give it a day
```

You don't need to type these. Ask the agent in the chat ("put this on Friday's review", "move the review to Monday") and it runs them. On Home you can also drag
a meeting's square along the river to another day, or off it to take its date away ([Home](the-window.md#home)).

## When a meeting's day comes

A meeting with a date and nothing held on it raises an alarm from its day on, the same way an overdue goal does: an urgent message at `naima hello` and at the end of every turn, once an hour, saying the meeting is due today, or was due on its day and was not held. It tells the agent to tell you now and to open the meeting before any other work, and `naima hello` says the same at the start of a session. The message does not wait for you to acknowledge it. It comes back until you hold the meeting (take it and close it), move its date or drop it (`naima meeting date review none`).

A meeting that has discussions and no date, or only the date of a meeting already held, is shown as to schedule, in `naima meeting`, on Home and in the Calendar, until you give it a day. The alarm is for meetings that need the owner; a meeting that needs only others raises none.

## In the app

The Meetings screen lists your meetings: the one on now, then those coming up by date, then those to schedule: meetings with discussions and no date.
Each says when it is, how many things are on it, and opens to show its agenda. Every item that waits for you, on any screen, says so, and says which meeting it
is on, or that it is on none yet. Home's Needs you starts with your next meeting and the others waiting. On Home, the meetings with a date before the focus
horizon are two small rings overlapping on the river ahead; a click holds one in the stage, one question at a time, and a click on the question brings it into
the chat ([Home](the-window.md#home)).

When you are ready, press **Take this meeting now**. Naima records that the meeting started and tells the agent in your chat, which opens with the agenda. The
same from a terminal is `naima meeting take <meeting>`. The agent learns of it because it keeps `naima meeting wait` running in the background: the command ends
when a meeting is taken and prints its agenda.

### Waiting for you

Waiting for you opens in Home's stage, under the river, from Home's sentence of what needs you, and on a page of its own at `#waiting`. It shows everything that
waits for you, one per row, each in one sentence with how long it has waited: questions and decisions, work waiting for your approval or your test, and agents
that have gone quiet. It lists only what lies before Home's focus horizon, the orange line on the river, which stands by default at the next major goal of the
line Home follows: what belongs to that goal, to one the river draws before it or to no goal, what is on a meeting dated before the horizon's day, and anything
that asks you now, such as an agent gone quiet. A question that only holds a later release waits until the horizon reaches it, on the owner's gate or a meeting
with no date too; moving the horizon to that release brings it in. The longest waiting comes first. When nothing waits, the page says so and stays quiet.

It lists exactly what Home's sentence counts, at the moment Home shows. When the orange line or the Diary shows a day of the past, Waiting for you shows what
waited for you then, with its age on that day, and nothing is sent from there.

Open an entry to see why it waits and what waits on it; reveal it to see all of that, item by item, and the meeting it is on. In Home's stage an entry opens
beside the list instead, with all of that, the item's own page in plain words and its history. **Bring it to the chat** hands it to the agent in your chat,
with why it waits and what waits on it, the same way anything in the window is brought to the chat
([bringing anything to the chat](the-window.md#bringing-anything-to-the-chat)): the strip at the foot of the window says when the agent has it, or offers
the message to copy when no chat session is listening. The entry leaves the list once it is settled. Opening and revealing an entry each have their own
address, so the browser's Back and Forward move between them and a reload keeps your place. From a terminal, `naima meeting raise <item>` leaves the topic
for an agent running `naima meeting wait`.

## At the start of a session

`naima hello` names each meeting that has discussions to take and is due, which means any meeting without a date, and a dated one from its date on:

```text
Meeting owner (With the owner) has 2 discussions to take (1 more deferred): when owner is here, open with its agenda, in its order — naima meeting owner — one question per message, each answer recorded at once (naima decide), no work started until it closes; owner decides when to stop, and what is left stays queued.
```

The agent then opens with that agenda, one question per message. It records each answer as soon as you give it, and starts no work while the meeting is on. You
decide when to stop. Whatever you didn't get to stays on the agenda for the next meeting.

## Record the decision

```sh
naima decide discussions/what-call-authored-expertise-sets "Call them playbooks"
```

This records the decision and the day on the discussion, and marks it decided. A discussion can't be marked decided without its decision. The agent can do this
on the main branch during the meeting: the trunk guard accepts it, because deciding changes only what Naima fills in.

A decision often calls for work. The agent files that work only after you say yes, and records your yes with it:

```sh
naima decide discussions/meeting-time "Whenever the owner is present" --follow-up "Say the agenda at session start" --consent "yes, file it"
```

The follow-up is a todo, linked to the discussion with `concerns`.

## Close the meeting

When you stop, the agent closes the meeting, and a meeting you took is marked held. Naima groups the decisions you just made into work packages, one for each
open item they concern, and proposes them:

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

Nothing is written until you have said yes. Each package's item gets a `ready` record: the day, the meeting, the decisions it carries, your yes, and whether to
start it now. Each decision is marked as turned into work, so the next close doesn't propose it again. A decision that concerns no open item is kept as it is.
If it calls for work, file that work, link it to the discussion with `concerns`, and close again.

## The ready queue

```sh
naima queue --ready
```

This lists the work you approved, in the order it starts: what you said to start now first, then by priority. Naima feeds itself from this queue. Whenever fewer
workers are running than the coordination option `maxWorkers` allows, the coordinator starts the next item with a worker, without asking you, and `naima hello`
and `naima claims` say which one to start. It starts nothing while a meeting with you is going on. `naima check` notes a worker slot left idle while approved
work waits.

## Where to read more

The commands, fields and the `meetings` option are in [the reference](../reference/reference.md), under the discussions plugin. Gates in general are in
[Plan with epics, milestones and gates](plan-with-epics-milestones-and-gates.md).
