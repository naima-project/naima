# The coordinator and the workers

How a session is staffed when agents do the work. It does not replace
[worktree isolation](worktree-isolation.md): that says what may be written
where; this says who does what.

## The shape

**One coordinator. Every piece of work in a background worker. The
coordinator does not do the work; it holds the conversation.**

```
          owner
            │  one question at a time, answers, decisions
            ▼
      COORDINATOR ── the trunk's one writer; drives a running app, a device
            │
            ├── worker ── own worktree, own branch ── reports ──┐
            ├── worker ── own worktree, own branch ── reports ──┤
            └── worker ── own worktree, own branch ── reports ──┘
                                                                │
                                naima land <branch> ◀───────────┘
```

### What the coordinator does, and only this

- Talks to the [owner](../guide/glossary.md#owner) — **one question at a time**, and only questions that
  are the owner's ([asking the human](asking-the-human.md)).
- Holds whatever only one actor may drive at a time: a running application, a
  device, a deployment. A worker never drives it unless it is handed over
  explicitly, and then the coordinator does not touch it until the worker
  reports.
- **The owner is a resource holder too.** A restart or a rebuild is asked
  first while he is present at the keyboard, and free to do without asking
  once he is away. While he is deciding, his decision comes first and the
  work that depends on it waits — the coordinator does not restart or
  rebuild around him just to keep busy.
- **Is the trunk's single writer.** It alone lands branches on the trunk,
  pushes it, publishes the site and makes releases, from the trunk; nothing
  is locked, because nothing else writes them
  ([the rule](../guide/rules.md#no-locks-the-coordinator-is-the-single-writer)).
- Spawns workers, merges their branches, and keeps the queue honest.
- Sets a timer that brings it back when nothing else will. The owner should
  never be the reason work resumes: [the non-stop loop](the-non-stop-loop.md)
  — an explicit target written first, a three-minute wake-up, stopping only
  when what is left is the owner's, and the owner's ordered action list as
  the deliverable.

### What a worker gets

Everything it needs to work without asking, because it cannot ask:

- **its own worktree** off the [trunk](../guide/glossary.md#trunk), its own branch, and its dependencies
  installed (a fresh checkout has none);
- **the item already filed** — a worker reads a tracker page, it does not
  invent scope — and it claims what it takes (`naima claim`);
- **what is already measured**, stated as given, so it does not re-derive it:
  the single biggest saving available;
- **the gates**, with their current numbers, to run at the end;
- **the constraints**: that it only prepares on its branch — it never lands,
  pushes the trunk, publishes or releases — that it does not
  commit on the trunk or touch another [worktree](../guide/glossary.md#worktree), which sibling branches'
  files it must stay out of;
- **no sub-agents of its own.** A worker that spawns workers loses all of
  their work when it stops.
- **the acknowledgement line to give back** — every report starts with it
  ([read the project's rules](read-the-project-rules.md#giving-the-acknowledgement-back)).

## The jobs

| Job | Owns | Refuses |
|---|---|---|
| **Coordinator** | the conversation, the trunk as its single writer (landing, pushing, publishing, releasing), the timer, spawning and merging | work a worker could do; more than one question at a time |
| **Lead developer** | the queue: sweeping fixed-but-unproven [items](../guide/glossary.md#item), preparing branches, the landing train | merging without the [gates](../guide/glossary.md#gate); closing an item on reasoning; closing its own branch's items |
| **Implementer** | one item, one cause, one branch | widening scope; spawning workers; touching the trunk |
| **Tester** | performing gestures on the running software and writing down what happened | fixing what it finds; testing what it just wrote |
| **Filer** | classification, [triage](../guide/glossary.md#triage) fields, reports routed to the right tracker | inventing scope; deciding whether something is proven |
| **Evidence owner** | whether a gesture proves the claim, weighed by [the evidence ranking](../guide/prove-and-close.md#3-perform-it-keep-the-evidence) and red-then-green for a regression | performing the gesture it then judges |

These jobs, and the outward ones — the release manager, the documentarian,
the [announcer](announcer.md), the community steward, the business role, and
the verification engineer — are data: `naima roles` lists each with what it
owns and refuses, and `naima queue --role <role>` is one role's queue, most
urgent first. An item is on a role's queue by its `role` field when set, else
by its `kind` (`code` is the implementer's, `test` the tester's) or its type
(every `tests` item is the tester's, every `releases` item the release
manager's). Staff a worker for a role from that queue.

Work passes between them in one direction:

```
report ─▶ filer files it ─▶ lead developer triages and ranks
                                    │
                                    ▼
                      implementer fixes it (own worktree)
                                    │
                                    ▼
          lead developer sweeps, runs the gates, merges ─▶ trunk
                                    │
                                    ▼
             tester performs the gesture ─▶ evidence owner closes it
```

Nothing skips a step by being obvious. The two arrows that look skippable —
naming the gesture for a fix, and judging a gesture someone performed — are
where work gets lost.

### The lead developer's three jobs

1. **The sweep.** Items whose fix already landed but whose [proof](../guide/glossary.md#proof) was never
   linked. Read the board against the code, mark what is already fixed, and
   name the gesture that would prove each one as a test item linked
   `verifies`. Without the sweep, several sessions each open the same item and
   each discover it is already fixed.
2. **Preparing branches** so the trunk is their ancestor: the trunk merged in
   first, the gates run over the combined result, claims released, session
   note written ([closing a worktree](closing-a-worktree.md)).
3. **The landing train.** Finished branches landed in order with `naima land`,
   gates between, each one a [marker](../guide/glossary.md#marker) naming the items it closes. If
   it refuses, stop.

It never merges without the gates, never closes an item on reasoning ("the
code clearly does this now" is a diagnosis, not a measurement), and never
closes its own branch's items.

### The tester and the resource holder are different actors

An actor that both drives the software and writes the assertion cannot tell a
fact about the software from the current state of something editable — to it
they are one motion. Keep them apart: the tester prepares or performs the
gesture, the evidence owner judges it.

## Choosing the model

**A worker's model is a parameter, and choosing it is the largest saving
available.** Use the strongest model for diagnosis and design, where being
wrong costs a day; a faster, cheaper one for filing, triage, classification,
merges, audits and running gates.

## How many at once

**Two** as the standing number; up to **four** only for short, cheap, parallel
work. Concurrency is bounded by the budget as much as by the load: too many
expensive workers at once exhaust it and die mid-task.

**When a worker dies, salvage before respawning.** Its worktree still holds
everything it had not committed. Separate the work from mechanical churn,
commit the work as WIP marked unreviewed, and hand the replacement that commit
to read rather than a blank start.

## Gates run after a batch, not after every commit

A worker commits freely — small commits, one idea each — and runs the full
gate set once per batch. If the batch comes back red, `git bisect` over its
own commits finds the culprit, which is what small commits are for. Commit
before running the gates, so a red gate never costs uncommitted work. A branch
is never reported done on an unrun gate set.

## Reporting

Workers report to the coordinator, never to the owner, in the shape
[the worker protocol](worker-protocol.md) fixes: what changed, red shown
before green, the gate numbers, the queue after the change, one question or
none. The coordinator's own reply to the owner keeps the same order and the
same restraint — never a preamble, never the number before the work, never a
restatement of what was just committed or filed: if it is worth explaining,
it is worth committing.

**Every report starts with the acknowledgement line** the project's rules ask
for (`naima rules --audience agents`, its last line) — a worker that omits it
is not reporting, it is talking. The coordinator checks it before trusting
the rest: `naima rules check-ack <file|->` on the worker's own reply, missing
phrases named if any; a breach is reported to the owner, not patched over.

## Safety rules

- **A worker never merges.** Candidate property for a later model: nothing
  yet checks that a trunk-merging commit came from the lead developer's
  session rather than a worker's; read from [the jobs table](#the-jobs)
  today, not verified.
- **A branch never closes its own items.** Enforced by `naima close`
  ([closing a worktree](closing-a-worktree.md#not-part-of-closing)).
- **The owner is never the reason work resumes.** Convention:
  [the non-stop loop](the-non-stop-loop.md) sets a timer instead of waiting
  on a reply.
- **One question at a time.** Convention: [asking the human](asking-the-human.md).
