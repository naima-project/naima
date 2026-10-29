# Discussions and meetings

Some questions can't be settled with a quick yes or no. A name for a new idea, the shape of a workflow, or a choice between two designs needs time with you.
Naima keeps each of these as a discussion, and gathers discussions into meetings, so that when you sit down with an agent it starts with what is waiting for
you.

| Word           | What it is                                                                                  | Made with                                |
| -------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **discussion** | a question that needs time with a person: the question, the options, and later the decision | `naima new discussions "<topic>"`        |
| **meeting**    | a gate whose agenda is the discussions on it; it holds once every one is decided            | `naima meeting new <name> "<title>"`     |
| **decision**   | what a discussion settled, recorded on it                                                   | `naima decide <discussion> "<decision>"` |

## File a discussion

```sh
naima new discussions "What to call authored expertise sets"
naima link discussions/what-call-authored-expertise-sets concerns features/authored-expertise-sets
```

The page of a discussion has room for the question, the options seen so far, and what to read before talking about it. The `concerns` link ties it to the items
it is about, so you can find the discussion from them as well.

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

`naima meeting` shows every agenda, open discussions first:

```text
owner — With the owner (needs owner; whenever owner is present): 2 open of 3
  ✗ discussions/what-call-authored-expertise-sets  What to call authored expertise sets  (about features/authored-expertise-sets)
  ✗ discussions/meeting-time  When a meeting takes place
  ✓ discussions/meeting-flow  How a meeting runs: Run it while the agent waits
```

A meeting is also a gate, so `naima gates` lists it with the discussions still open, and it holds once each one is decided.

## At the start of a session

`naima hello` names each meeting that has open discussions and is due, which means any meeting without a date, and a dated one from its date on:

```text
Meeting owner (With the owner) has 2 open discussions: when owner is here, open with its agenda — naima meeting owner.
```

The agent then opens with that agenda, one discussion at a time.

## Record the decision

```sh
naima decide discussions/what-call-authored-expertise-sets "Call them playbooks"
```

This records the decision and the day on the discussion, and marks it decided. A discussion can't be marked decided without its decision.

A decision often calls for work. The agent files that work only after you say yes, and records your yes with it:

```sh
naima decide discussions/meeting-time "Whenever the owner is present" --follow-up "Say the agenda at session start" --consent "yes, file it"
```

The follow-up is a todo, linked from the discussion with `concerns`.

## Where to read more

The commands, fields and the `meetings` option are in [the reference](../reference/reference.md), under the discussions plugin. Gates in general are in
[Plan with epics, milestones and gates](plan-with-epics-milestones-and-gates.md).
