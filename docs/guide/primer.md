# The Naima primer

You don't need anything on this page to start using Naima. Once it is
installed, the agents handle all of it for you: they file what you report,
keep track of the work, prove it and close it, and they ask you only about
the things that are yours to decide. Read on if you want to understand what
they are doing and why.

This page walks through the ideas Naima uses, roughly in the order you run
into them on a real project. It takes about fifteen minutes to read. You
don't need to know git or to write code. Terms link to the
[glossary](glossary.md), and each section points to the page with the
details. The rules themselves live on [the rules page](rules.md).

The commands shown along the way are the ones the agents run for you. They
are here so you can recognise them when you see them go by. You can run any
of them yourself if you want to, but you never have to.

As a running example, take a small online bakery whose owner has asked a team
of agents to build and run the shop.

## 1. The project, the owner, the agents

A project is whatever lives in one git [repository](glossary.md#repository).
Usually that is software, but a data analysis or a paper you write with
colleagues works just as well. You are the [owner](glossary.md#owner): you
decide what you want and you judge the things only a person can judge. You
never have to type a command.

The [agents](glossary.md#agent) do the rest. One of them, the
[coordinator](glossary.md#coordinator), is the one you talk to. The others,
the [workers](glossary.md#worker), take pieces of work, do them in the
background and report back. A [session](glossary.md#session) is one stretch
of work by one agent. Agents don't remember anything from one session to the
next, which is why everything important gets written down.

It gets written down in the [tracker](glossary.md#tracker): a folder called
`naima-tracker/` inside your repository, made of plain files that are
versioned along with the work. There is no server to run and no account to
create ([the tracker folder](tracker-folder.md)). Naima is the program that
reads and writes that folder and checks that it stays consistent.

For example, you tell the coordinator that customers should be able to order
bread for the next morning. A few seconds later that request is a file in the
tracker.

## 2. Items and their types

Each piece of work written down in the tracker is an
[item](glossary.md#item). An item is a small folder with a page of text (what
the item is about and what is still missing), a few fields such as status,
priority and dates, and any evidence collected along the way. Bug reports,
requests, plans and proofs are all items, and every item has a
[type](glossary.md#type):

| Type | What it is for | In the bakery |
|---|---|---|
| [bug](glossary.md#bug) | something that is broken | the total ignores the discount |
| [todo](glossary.md#todo) | a job that isn't a defect | move the photos to the new folder |
| [feature](glossary.md#feature) | something the software should do | order for tomorrow morning |
| [requirement](glossary.md#requirement) | a condition the result must meet, in a way you can check | an order placed by 20:00 is ready by 7:00 |
| [specification](glossary.md#specification) | a precise, versioned description of how something behaves | orders: the form, the cut-off time, the receipt |
| [decision](glossary.md#decision) | a choice you made, written down once | no orders on Sundays |
| [artifact](glossary.md#artifact) | something the work makes and keeps, such as a report or a figure, due by a date | the monthly sales report |
| [test](glossary.md#test-item) | a way to check something, and what happened when it was run | order at 19:59 and the receipt says 7:00 |
| [property](glossary.md#property) | a statement about a model of the design, checked by a tool | two orders never get the same number |
| [rule](glossary.md#rule) | something the project always sticks to | ask before deleting anything |
| [epic](glossary.md#epic) | a larger goal that groups other items | launch the online shop |

Bugs, todos and features are what other trackers usually call issues. Naima
keeps them as separate types because each one is checked and closed in its
own way.

Metrics are not items. A [metric](metrics-and-budgets.md) is a measurement
you declare once, such as how long the tests take or how fast a page loads,
and Naima records it on every commit.

`naima types` lists the types your project has and the statuses each can
take; plugins can add new ones. When you report something, the agent files it
straight away, in its own words, with a command like this one (as everywhere
on this page, the agent runs it, not you):

```sh
naima new bugs "The total ignores the discount"
```

## 3. Status, and the difference between fixed, resolved and closed

Every item has a [status](glossary.md#status), and each status counts either
as open (there is still something to do) or as done. A bug can be `open`,
`partial` or `wontfix`. A feature moves from `requested` to `planned` to
`shipped`, or gets `withdrawn`. A test is `open`, `passed` or `failed`.

For bugs and todos, finishing happens in three separate steps:

- [fixed](glossary.md#fixed): the change has been made, but nothing has been
  checked yet.
- [resolved](glossary.md#resolved): a test or property that covers the fix
  has passed.
- [closed](glossary.md#closed): the item has been resolved and moved to the
  archive, together with its proof.

Because of this, "how many bugs are left" and "how many fixes still need
checking" are two different numbers, and Naima reports them separately
([the rule](rules.md#fixed-resolved-and-closed-are-three-states)).

In the bakery, once the agent has changed the discount code, the bug is
fixed. It isn't resolved until a test shows the discount working.

## 4. Triage

Right after an item is filed, an agent [triages](glossary.md#triage) it: it
rewrites the description so it is clear, looks for duplicates, and sets a few
fields. These are [priority](glossary.md#priority) (`now`, `next`, `later`,
`parked`), [impact](glossary.md#impact) (from `blocker` down to `low`),
[effort](glossary.md#effort) (`S` to `XL`) and
[confidence](glossary.md#confidence) (from `reported` up to `measured`).
There is also [run by](glossary.md#run-by), which says who has to carry out
the proof: an agent, a person, or a build machine. When it has to be a
person, the item says [why](glossary.md#human-because).

```sh
naima triage set total-ignores-discount priority=now impact=high
```

More in [triage](triage.md).

## 5. Links between items

A [link](glossary.md#link) records how two items relate. You only write one
direction; Naima works out the reverse when it reads the tracker, so the two
sides can't drift apart. These are the [relations](glossary.md#relation)
you'll see most:

| Relation | Meaning | Example |
|---|---|---|
| `blocked-by` | waits on | the receipt e-mail waits on the order form |
| `part-of` | belongs to | the order form belongs to the epic "launch the shop" |
| `verifies` | is the test for | the 19:59 test checks the cut-off feature |
| `specified-by` | follows | the order form follows version 2 of the orders specification |
| `satisfies` | delivers or proves | the cut-off feature delivers "ready by 7:00" |
| `settles` | answers | "no Sunday orders" answers "which days do we open?" |
| `duplicate-of` | reports the same thing as | two reports of the same wrong total |

```sh
naima link tests/order-at-1959 verifies features/order-for-tomorrow
```

Once dependencies are recorded, `naima ready` shows what can be started now
and `naima order` lists all the work in an order that respects them
([say what waits on what](plan-with-epics-milestones-and-gates.md#say-what-waits-on-what-the-order-of-the-work)).

## 6. Planning, and waiting for your go-ahead

A new request starts as a feature with status `requested`. Before anyone
works on it, the agent writes down on the item what finished will look like:
how it should behave, where its limits are, how it will be documented. If the
behaviour has to be exact, it also writes a
[specification](glossary.md#specification). Then it waits for you to say go
([the rule](rules.md#dont-start-implementing-until-the-owner-says-so)).

Your answers to its questions are saved as
[decisions](glossary.md#decision). Agents search them before asking you
anything, so you shouldn't get the same question twice.

```sh
naima decisions sunday
```

More in [plan with requirements, specifications and decisions](plan-with-requirements-specs-and-decisions.md).

## 7. Evidence

When an agent says "the discount works now", that is a
[claim](glossary.md#claim), and Naima doesn't accept it on its own. It wants
a [proof](glossary.md#proof), meaning a check anyone can repeat, and the
[evidence](glossary.md#evidence) that check produced: a log line, a
screenshot, a count before and after, stored with the item. There are three
kinds of proof:

- A test is something you do plus what you expect to see. A test for a bug
  fix only counts if it was seen failing before the fix and passing after it
  ([red, then green](glossary.md#red-then-green)).
- A property is a statement about a model of the design. A
  [verifier](glossary.md#verifier), which is a formal-methods tool, proves it
  or finds a counterexample; `naima verify` runs it and keeps the run as
  evidence.
- A metric keeps a number within a budget, for instance "the page loads in
  under a second", measured on every commit.

Not all evidence is equal. The strongest is you trying it yourself and seeing
it work; "the code looks right" is the weakest. A proof also only covers the
code it ran on, so if that code changes, the proof has to run again
([prove and close](prove-and-close.md)).

```sh
naima set tests/discount-applied status=passed   # once it has been seen failing, then passing
```

In the bakery, the agent writes a test saying that a 10% discount on 20 €
comes to 18 €. It runs the test on the old code, where it fails, then on the
fixed code, where it passes, and attaches both outputs. The bug is now
resolved. A different agent from the one that made the fix then closes it
([the rule](rules.md#whoever-fixes-does-not-also-close)).

## 8. Epics

An [epic](glossary.md#epic) groups the items that serve one goal. You never
set an epic's status yourself: it stays open as long as any of its items is
open, and it is done once all of them are closed.

```sh
naima epic add launch-the-shop features/order-for-tomorrow bugs/total-ignores-discount
```

`naima epic` lists the open epics, how many of their items are closed, and
who is needed to finish the rest.

## 9. Gates

A [gate](glossary.md#gate) is something that has to wait until certain work
is finished: a release, a merge, a submission. You add items to it, and the
gate holds when none of them is in the way any more. By default a gate waits
for the work to be done; you can also make it wait until every proof has
passed. A release is only made from a gate that holds.

```sh
naima gate new launch "Shop goes live" --says "the first real customers"
```

`naima gates` shows which gates hold, and `naima gate show launch` shows
what is still blocking that one and who has to deal with each blocker.

## 10. Milestones

A [milestone](glossary.md#milestone) is a gate with a due date, and
optionally a version number. Naima counts down the days, and if the date goes
by while the gate still doesn't hold, `naima check` mentions it. It's
reported as information, not as an error.

```sh
naima gate new launch "Shop goes live" --due 2026-12-01 --version 1.0
```

More on epics, gates and milestones in
[plan with epics, milestones and gates](plan-with-epics-milestones-and-gates.md).

## 11. Events, the timeline and the diary

Most of a project's history can be worked out from the tracker: when a gate
opened (its first item was filed) and when it passed (its last item was
resolved), when an epic was finished, each release, each session.
`naima view timeline` puts all of that in order. Some things can't be worked
out, such as a decision made in a meeting or a build handed to testers, so
you or an agent record those as [events](glossary.md#event).

Events of kind `diary` make up the project's [diary](glossary.md#diary): a
day-by-day account of what happened and why. `naima diary` reads it back,
along with each decision and its reason and the note from each session.

```sh
naima event 2026-10-15 "The shop opens to friends first, to test the orders" --kind diary
```

More in [keep a diary](plan-with-epics-milestones-and-gates.md#keep-a-diary).

## 12. Seeing where things stand

Naima doesn't store the state of the project anywhere. It
[derives](glossary.md#derived) it from the items each time you ask, so what
you see is always current.

| Command | What it shows |
|---|---|
| `naima summary` | the whole project on one screen |
| `naima board bugs` | one type's open items, grouped, most urgent first ([board](glossary.md#board)) |
| `naima queue launch --human` | the items on a gate that need a person, and why ([queue](glossary.md#queue)) |
| `naima view timeline` | what happened when |
| `naima ui` | all of the above in a window: summary, gates, boards, metrics, evidence |

More in [read the board, the queue and the gates](read-the-board.md).

## 13. Working in parallel

Several agents can work at the same time without getting in each other's way.
Each piece of work gets its own [branch](glossary.md#branch), a separate line
of history next to the main one (the [trunk](glossary.md#trunk)), and its own
[worktree](glossary.md#worktree), a separate copy of the project folder. A
[claim file](glossary.md#claim-file) records which branch is working on which
items, so everyone can see who is doing what. Claims are only information:
they don't stop anyone else from working on the same item.

```sh
naima open total-ignores-discount --as agent
```

When the work on a branch has been proven, the coordinator
[lands](glossary.md#landing) it on the trunk as a single commit that names
the items it closes. At the end of each session the agent writes a
[session note](glossary.md#session-note) saying what changed, what has been
proven and what is still open, and the next session picks up from there. More
in [work on several branches at once](several-branches.md).

## 14. Long-running work

Some jobs take hours: a benchmark, a batch of analyses, a model checker. These
are started as a [run](glossary.md#run). A run has a name, keeps going after
the session that started it ends, and has a time limit (plus a disk limit for
the files it creates), a log, and a progress file that says how far along it
is and roughly how long is left. That way a slow run can be told apart from
one that is stuck. Agents wait for a run by name and clean up after it.

```sh
naima run benchmark --budget-time 2h -- sh bench.sh
```

More in [long work](long-work.md).

## 15. Rules and checks

A [rule](glossary.md#rule) is something the project always sticks to, along
with the reason for it. The rules that apply to every project are collected
on [one page](rules.md), each marked as either enforced by Naima or followed
by convention. Your own standing choices can become rules of your project,
and every agent reads them before starting work
([write a project rule](write-a-project-rule.md)).

When a program enforces a rule, that's a [check](glossary.md#check).
`naima check` runs every check over the tracker, much as tests run over code.
It catches things like a broken link in the documentation, a proof that is
older than the change it was supposed to cover, or two items that wait on
each other. When everything is in order it prints `all invariants hold`.

```sh
naima check
```

## Where to go next

- [How the project runs](how-the-project-runs.md) puts these ideas together
  as one flow, from a report to a closed item.
- [The tutorial](tutorial.md) goes from an empty repository to a closed bug,
  showing every command with its real output; then there is
  [a second tutorial](tutorial-2.md).
- [Concepts](concepts.md) explains the mechanics underneath, the
  [glossary](glossary.md) defines every term, and the
  [reference](../reference/reference.md), generated from the code, documents
  every command.
