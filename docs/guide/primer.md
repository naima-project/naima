# The Naima primer

Every idea Naima uses, in the order you will meet it while your project
runs. Read it once, top to bottom, in about fifteen minutes. Nothing here
assumes you write code, know git or have managed a project: an AI agent does
the machine work, and the commands are shown so you can recognise what it
does. Each term links to its full definition in the [glossary](glossary.md),
and each section to the page that has the detail. The rules are not repeated
here: they are all on [the rules page](rules.md).

One example runs through the page: a small web shop that sells bread, whose
owner has asked agents to build and run it.

## 1. The project, the owner, the agents

The **project** is the work kept in one git [repository](glossary.md#repository):
software most often, but a data analysis or a paper with colleagues works the
same way. The [owner](glossary.md#owner) is the person the project answers
to — you. You decide what is wanted, and you judge what only a person can
judge; you never need to type a command.

The [agents](glossary.md#agent) do everything else. One of them, the
[coordinator](glossary.md#coordinator), talks to you; the others, the
[workers](glossary.md#worker), do pieces of work in the background and hand
them back. A [session](glossary.md#session) is one stretch of work by one
agent; agents forget between sessions, so everything that matters is written
down.

It is written down in the [tracker](glossary.md#tracker), a folder in your
repository called `naima-tracker/`: plain files, versioned with the work, no
server and no account ([the tracker folder](tracker-folder.md)). Naima is the
program that keeps that folder honest.

*Example:* you tell the coordinator "customers should be able to order
for tomorrow morning". That sentence is about to become a file.

## 2. The item, and its types

An [item](glossary.md#item) is one piece of the work written down: a folder
holding a page of prose (what it is, what is left), its fields (status,
priority, dates) and its evidence. Every report, request, plan and proof is an
item, and every item has a [type](glossary.md#type):

| Type | What it holds | Bread-shop example |
|---|---|---|
| [bug](glossary.md#bug) | something broken | "the total ignores the discount" |
| [todo](glossary.md#todo) | work that is not a defect | "move the photos to the new folder" |
| [feature](glossary.md#feature) | something it should do | "order for tomorrow morning" |
| [requirement](glossary.md#requirement) | what the result must satisfy, checkably | "an order placed by 20:00 is ready by 7:00" |
| [specification](glossary.md#specification) | exactly how something must behave, in versions | "orders: the form, the cut-off, the receipt" |
| [decision](glossary.md#decision) | a choice of yours, recorded once | "no orders on Sundays" |
| [test](glossary.md#test-item) | a gesture that proves something, and its result | "order at 19:59, the receipt says 7:00" |
| [property](glossary.md#property) | a statement a tool proves of a model of the design | "two orders never get the same number" |
| [rule](glossary.md#rule) | something the project always holds to | "ask before deleting anything" |
| [epic](glossary.md#epic) | a body of work that groups other items | "launch the online shop" |

**"Issue" is not a Naima word.** It is the everyday word, from other
trackers, for a bug, a todo or a feature; in Naima you say which one it is,
because each is proven and closed differently.

A **metric** is not an item either: it is a measurement the project declares
once — test time, coverage, page load time — and Naima takes it on every
commit ([metrics and budgets](metrics-and-budgets.md)).

`naima types` lists the types a project has, each with its statuses; plugins
can add more. When you report something, the agent files it at once, in its
own words:

```sh
naima new bugs "The total ignores the discount"
```

## 3. Status: open, done, and three words that are not synonyms

Every item has a [status](glossary.md#status), and every status is in one of
two categories: **open** (still to do) or **done** (settled). A bug is
`open`, `partial` or `wontfix`; a feature goes from `requested` to `planned`
to `shipped`, or is `withdrawn`; a test is `open`, `passed` or `failed`.

For a bug or a todo, "done" is three distinct steps:

- [fixed](glossary.md#fixed) — the change exists. Nothing is proven yet.
- [resolved](glossary.md#resolved) — fixed, and a test or property that
  proves it has passed.
- [closed](glossary.md#closed) — resolved, and moved to the archive with its
  proof.

So "how many bugs are left" counts the unfixed ones; fixed but unproven is a
different number, and Naima never adds the two
([the rule](rules.md#fixed-resolved-and-closed-are-three-states)).

*Example:* the agent changes the discount code. The bug is fixed. It is not
done.

## 4. Triage: how urgent, how big, whose hands

As soon as an item is filed, an agent [triages](glossary.md#triage) it:
rewrites it clearly, looks for duplicates, and ranks it. The fields it sets
are plain lists: [priority](glossary.md#priority) (`now`, `next`, `later`,
`parked`), [impact](glossary.md#impact) (`blocker` to `low`),
[effort](glossary.md#effort) (`S` to `XL`), and
[confidence](glossary.md#confidence) (from `reported` to `measured`). One
more says whose hands the proof needs, [run by](glossary.md#run-by): an
agent's, a person's, or a build machine's — and when it is a person's,
[why](glossary.md#human-because).

```sh
naima triage set total-ignores-discount priority=now impact=high
```

Detail: [triage](triage.md).

## 5. Links: how items depend on each other

A [link](glossary.md#link) says how two items relate. Only one direction is
written; Naima works out the other side when it reads, so they never
disagree. The [relations](glossary.md#relation) you will meet:

| Relation | Reads as | Example |
|---|---|---|
| `blocked-by` | waits on | the receipt e-mail is blocked by the order form |
| `part-of` | is part of | the order form is part of the epic "launch the shop" |
| `verifies` | is the gesture that proves | the 19:59 test verifies the cut-off feature |
| `specified-by` | follows the specification | the order form follows "orders, version 2" |
| `satisfies` | delivers or proves the requirement | the cut-off feature satisfies "ready by 7:00" |
| `settles` | is the decision that answers | "no Sunday orders" settles "which days?" |
| `duplicate-of` | describes the same thing as | two reports of the same wrong total |

```sh
naima link tests/order-at-1959 verifies features/order-for-tomorrow
```

With the waits written down, `naima ready` lists what can start now and
`naima order` the whole plan in a workable order
([say what waits on what](plan-with-epics-milestones-and-gates.md#say-what-waits-on-what-the-order-of-the-work)).

## 6. Before work starts: the plan and your go

A request is filed as a feature in status `requested`. Before any work, the
agent writes on it what "done" means — the behaviour, its limits, how it
will be documented — and, when the behaviour must be exact, a
[specification](glossary.md#specification) the work will follow. Then it
waits for your go ([the rule](rules.md#dont-start-implementing-until-the-owner-says-so)).
Your answers are recorded as [decisions](glossary.md#decision), and an agent
searches them before it asks you anything, so a settled question is not asked
twice.

```sh
naima decisions sunday
```

Detail: [plan with requirements, specifications and decisions](plan-with-requirements-specs-and-decisions.md).

## 7. Evidence: nothing is done until shown to be

A [claim](glossary.md#claim) — "the discount works now" — proves nothing on
its own. A [proof](glossary.md#proof) is a repeatable way to check it, and
[evidence](glossary.md#evidence) is what the check showed: a log line, a
screenshot, a before-and-after count, kept with the item. Three kinds of
proof:

- **A test** is a gesture and its result. A test that proves a bug fix
  counts only if it was seen failing before the fix and passing after:
  [red, then green](glossary.md#red-then-green).
- **A property** is a statement about a model of the design, proven or
  refuted by a [verifier](glossary.md#verifier), a formal-methods tool;
  `naima verify` runs it and keeps the run as evidence.
- **A metric** holds a number to a budget: "the page loads in under a
  second", measured on every commit.

Evidence is ranked: you performing the gesture and seeing it is strongest;
"the code looks right" proves nothing. A proof counts only for what it ran
on: change the code it proved, and it must run again
([prove and close](prove-and-close.md)).

```sh
naima set tests/discount-applied status=passed   # after it was seen red, then green
```

*Example:* the agent writes a test "a 10% discount on 20 € gives 18 €", runs
it on the old code (it fails), on the fix (it passes), and attaches both
outputs. The bug is now resolved. Another agent, not the one that fixed it,
closes it ([the rule](rules.md#whoever-fixes-does-not-also-close)).

## 8. Epic: a body of work

An [epic](glossary.md#epic) groups items that belong to one goal. You do not
set its status: it is open while any of its items is open, and done when
every one is closed.

```sh
naima epic add launch-the-shop features/order-for-tomorrow bugs/total-ignores-discount
```

`naima epic` shows each open epic, how many of its items are closed, and
whose hands the rest need.

## 9. Gate: what must be settled first

A [gate](glossary.md#gate) is what something waits on — a release, a merge,
a submission. Items join it, and it **holds** when nothing on it blocks. By
default it waits for the work to be done; it can be told to wait for every
proof too. A release is never cut on a gate that does not hold.

```sh
naima gate new launch "Shop goes live" --says "the first real customers"
```

`naima gates` says which gates hold; `naima gate show launch` says what
blocks this one and whose hands each blocker needs.

## 10. Milestone: a gate with a date

A [milestone](glossary.md#milestone) is a gate with a due date, and
optionally a version. Naima counts the days left, and once the date has
passed while the gate does not hold, `naima check` says so — as news, not as
a failure.

```sh
naima gate new launch "Shop goes live" --due 2026-12-01 --version 1.0   # a gate with a date
```

Detail for epics, gates and milestones:
[plan with epics, milestones and gates](plan-with-epics-milestones-and-gates.md).

## 11. Events, the timeline and the diary

Most of the project's history is worked out, never written twice: when a
gate opened (its first item filed) and passed (its last resolved), when an
epic finished, each release, each session. `naima view timeline` shows it.
What Naima cannot work out — a decision taken in a meeting, a build handed to
testers — you or an agent record as an [event](glossary.md#event).

An event of the kind `diary` is a line of the project's
[diary](glossary.md#diary): what happened and why, day by day. `naima diary`
tells the story back, with each decision and its reason and each session's
note.

```sh
naima event 2026-10-15 "The shop opens to friends first, to test the orders" --kind diary
```

Detail: [keep a diary](plan-with-epics-milestones-and-gates.md#keep-a-diary).

## 12. Seeing where things stand

Nothing about where things stand is stored: it is
[derived](glossary.md#derived) from the items every time you ask, so it is
never out of date.

| Ask | You get |
|---|---|
| `naima summary` | the whole project in one screen |
| `naima board bugs` | a type's open items by section, most urgent first ([board](glossary.md#board)) |
| `naima queue launch --human` | what on a gate needs a person, each with why ([queue](glossary.md#queue)) |
| `naima view timeline` | when things happened |
| `naima ui` | all of it in a window: summary, gates, boards, metrics, evidence |

Detail: [read the board, the queue and the gates](read-the-board.md).

## 13. Working in parallel: claims, branches, worktrees

Several agents can work at once without stepping on each other. Each piece
of work gets its own [branch](glossary.md#branch) — a line of history apart
from the main one, the [trunk](glossary.md#trunk) — and its own
[worktree](glossary.md#worktree), a separate copy of the folder. A
[claim file](glossary.md#claim-file) records which branch holds which items,
so everyone sees who works on what; it never locks anyone out.

```sh
naima open total-ignores-discount --as claude
```

When the work is proven, the coordinator [lands](glossary.md#landing) the
branch on the trunk as one commit naming the items it closes. At the end of
a session the agent writes a [session note](glossary.md#session-note) — what
changed, what is proven, what is left — and the next session starts from it.
Detail: [work on several branches at once](several-branches.md).

## 14. Long work and its progress

Some work takes hours: a benchmark, a batch of analyses, a model checker.
It is started as a [run](glossary.md#run): named, detached from the session,
with a time budget (and a disk budget for what it creates), a log, and a
progress file saying how far it is and how long is left, so a slow run is
never mistaken for a hung one. An agent waits for it by name and cleans up
after it.

```sh
naima run nightly-benchmark --budget-time 2h -- sh bench.sh
```

Detail: [long work](long-work.md).

## 15. Rules, and the check that holds them

A [rule](glossary.md#rule) is something the project always holds to, with
its reason. The rules every project holds to are on
[one page](rules.md), each marked enforced by Naima or kept by convention.
Your own standing choices become rules of your project, and every agent reads
them at the start of work ([write a project rule](write-a-project-rule.md)).

A rule that a program enforces is a [check](glossary.md#check). `naima check`
holds the whole tracker to every check, the way tests hold the code: it
finds a broken link in the docs, a proof older than the work it proved, two
items that wait on each other. It
ends with `all invariants hold` when nothing is wrong.

```sh
naima check
```

## Where to go next

- [How the project runs](how-the-project-runs.md): the same ideas as one
  flow, report to close.
- [The tutorial](tutorial.md): an empty repository to a closed bug, every
  command with its real output; then [a second tutorial](tutorial-2.md).
- [Concepts](concepts.md), for the mechanics underneath; the
  [glossary](glossary.md) for every term; the
  [reference](../reference/reference.md) for every command, generated from
  the code.
