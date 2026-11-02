# Plan with epics, milestones and gates

Naima has three ways to say what a body of work is for and when it is done, and each of them takes a single command. Nothing here needs you to edit `naima.json`
by hand. The agents run these commands for you, unless you want to run them yourself.

| Word          | What it is                                                                  | Made with                                       |
| ------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| **epic**      | a body of work that groups items; done when they all are                    | `naima new epics "<title>"`                     |
| **gate**      | what must be settled before something may happen, like a release or a merge | `naima gate new <name> "<title>"`               |
| **milestone** | a gate with a date, and optionally a version                                | `naima gate new … --due YYYY-MM-DD --version v` |

## Group work in an epic

```sh
naima new epics "Onboarding"
naima epic add onboarding bugs/first-run-crash todos/welcome-copy features/sample-project
```

Each item is now `part-of` the epic. Nobody sets the epic's status, because it follows its items. It is `open` while any of them is open and `done` once every
one is closed, and Naima refuses an attempt to set it by hand to something its items contradict.

```sh
naima epic
```

```text
epics/onboarding  Onboarding  [open]  1 of 3 closed · gate beta
  waiting on: agent 1, human 1
  ✗ bugs/first-run-crash  First run crashes  (agent)
  ✗ features/sample-project  A sample project  (human)
```

For each open epic, this shows how many of its items are closed, what it is still waiting for, and who has to deal with each remaining item: an agent, a person
or a build ([triage](triage.md)). `naima epic --all` lists the finished epics too, and `naima epic remove onboarding todos/welcome-copy` takes an item out.

## Declare a gate

When someone says "that's a gate for the beta", the agent runs:

```sh
naima gate new beta "Public beta" --says "the first outside users"
naima gate add beta bugs/first-run-crash epics/onboarding
```

The gate is written into the project's configuration, and it is checked in the same way it will later be read. The items get `gate=beta` through the same checks
as any `naima set`. An epic on a gate stands for its items, so the gate waits for them rather than for the epic itself. An empty epic on a gate blocks it,
because nothing has been planned yet.

By default a gate waits for **code**, which means that a fixed item that still owes its proof doesn't block it. `--holds-on proof` makes the gate wait for every
proof as well ([prove and close](prove-and-close.md)).

```sh
naima gate show beta          # what blocks it, what is owed, whose hands
naima gate remove beta bugs/first-run-crash
```

## Give it a date: a milestone

```sh
naima gate new beta "Public beta" --due 2026-12-01 --version 0.9
```

```text
$ naima gates
beta — Public beta (version 0.9; due 2026-12-01, 17 days left): BLOCKED by 2
```

`naima gates`, `naima queue beta` and `naima summary` show the number of days left, `today`, or how many days overdue it is. Once the date has passed and the
gate still doesn't hold, `naima check` warns about it (the check `milestone-overdue`). This is a note rather than a failure, because a late milestone is
something to know about, not a sign that the project is broken.

A date moves, or comes off, with `naima gate set`: `naima gate set beta --due
2026-12-15` changes it, and `naima gate set beta --due ""` takes it off. The same
command changes a gate's title, what it says, its version, what it holds on and its coverage lists, and makes it a release gate that waits for the full suite
(`--full-suite`), or no longer (`--no-full-suite`).

`naima gates --json` prints the same information as data: each gate's name, title and timing, whether it holds, and the items that block it or only still owe a
proof.

## Follow a stance's method: steps as sub-goals

A stance can bring a method: an ordered list of steps, each with what must be true for it to be done, such as "you chose a palette among the variants". When a
gate follows the method, those steps become sub-goals of the gate, and the gate holds only once every one of them is done, in order, on top of its own items.

```sh
naima gate set beta --method ui/design
```

`ui/design` is the method `design` of the UI stance, which has to be adopted first. The name of the stance's plugin works too (`stance-ui/design`), and that is
what the gate records. `--method ""` takes the method off. `naima gates`, `naima gate show` and `naima hello` then show the steps:

```text
$ naima gates beta
beta — Public beta (due 2026-12-01, 17 days left): BLOCKED by 1
  ✗ step 2 of 3 of stance-ui/design is next: palette (Palette), closed when you chose a palette among the variants — naima gate step beta palette --by <item>
  steps (method stance-ui/design): 1 of 3 closed
  ✓ step 1 mood-board  Mood board — closed by decisions/the-mood-board-is-calm
  → step 2 palette  Palette — next, closed when you chose a palette among the variants
  · step 3 screens  Screens — waits for the step before
  ✗ bugs/first-run-crash  First run crashes
```

A step is closed by a record of what you decided: usually a decision, once it is settled. The agent closes the step with it.

```sh
naima gate step beta palette --by decisions/the-palette-is-dusk
```

This writes `closesStep: beta/palette` on the decision, and nothing on the gate. It refuses while the step before is not closed, and while the decision is still
open. Because the steps are worked out from the records every time, their order can't be broken by hand either: a record written for a later step counts only
once every step before it is closed, and if a decision is reopened, its step and every step after it are open again. `naima check` notes a record that names a
gate with no steps, or a step the gate doesn't have, and reports a gate whose method no adopted stance provides.

## Break a goal into steps of its own

A gate can also have steps of its own, with no stance involved: you, or an agent, break a goal into sub-goals, each with a name, a title and what must be true
for it to be done.

```sh
naima gate step add release-1.2 skeleton "The skeleton runs" --exit "the empty app starts and serves its first screen"
naima gate step add release-1.2 screens "The screens" --exit "you accepted every screen"
naima gate step add release-1.2 live "Live server" --exit "the server pushes every change" --after skeleton
naima gate step remove release-1.2 live
```

A new step goes last, right after the one `--after` names, or first with `--first`. They close exactly as a method's steps do, in order and on a settled record,
with `naima gate step <gate> <step> --by <item>`, and `naima gates`, `naima gate show` and `naima hello` show them the same way. A gate that follows a method
and has steps of its own takes the method's steps first and its own after them: `--after` can name the method's last step, but no other. A step of its own can't
share a name with a step of the method. `naima gate step remove` refuses a step while a record names it, since that record would then close nothing; take the
`closesStep` off the record first. Adding a step to a goal that already held means it no longer holds until that step is closed.

The steps are stored on the gate, under its `steps`, in `naima.json`, and like every setting of a gate they belong to the trunk: add or remove them on the
trunk, never on a [development line](lines.md), which gets them when it is brought up to date with the trunk. That is also what makes them useful on a line: a
goal's sub-goals can't be separate milestones there, since a milestone that comes before the line's goal could never land on it, but steps of the line's own
gate can.

## See when things happened: the timeline

```sh
naima view timeline
```

```text
2026-09-02  gate opened   gate beta (Public beta): the first of its 12 items reported
2026-09-14  record        build: Build 3 handed to the testers
2026-10-20  gate passed   gate beta (Public beta): the last of its 12 items resolved
2026-10-21  release       version tag v0.9
undated, not placed: epic finished 1 — an item without created, or resolved without closedOn or fixedOn
```

None of this is stored. Each event is worked out from the items and from git every time. A gate opens on the day its first item was reported. Once none of its
items is open, it passes on the day its last item was resolved, which is the day it was archived (`closedOn`) or, failing that, the day it was fixed
(`fixedOn`). An epic is dated the same way, from its items. A release is a version tag (`v0.9`, `1.2`), dated by its commit, and a session is dated by its note
(`naima pass`). Anything without a date is counted at the bottom instead of being placed on a guessed day.

You only need to write down what the tracker can't know, such as a decision taken in a meeting, a build handed out, a policy or an outside fact.

```sh
naima event 2026-09-14 "Build 3 handed to the testers" --kind build
```

Each event is one file in `naima-tracker/naima-data/events/`.

## Say what waits on what: the order of the work

A plan is rarely a simple list. A specification waits on its requirements, a model waits on its specification, and a release waits on everything it ships. You
record each of these waits with one link.

```sh
naima link todos/write-the-specification blocked-by todos/write-the-requirements
```

Naima can then read the plan for you.

```sh
naima ready          # what can start now: every open item whose blockers are all settled
naima order          # the whole plan in an order that respects every wait, with each item's depth
```

```text
$ naima order
all items: 4 in order, deepest wait 2
  0  todos/write-requirements  Write the requirements
  1  todos/write-docs  Write the docs
  1  todos/write-specification  Write the specification
  2  todos/model-it  Model it
```

The depth is the number of waits that come before an item, and a blocker that is already settled doesn't hold anything back. Both commands accept a gate's name,
to show only that gate's items, and both accept `--json`. Items that wait on each other in a cycle could never start, so `naima check` fails on such a cycle
(the check `dependencies-acyclic`) and names every item in it.

Both commands list only work. An epic is done when its items are, so it isn't listed, and waiting on an epic means waiting on its open items. A requirement
isn't listed either, because it is what the work is held to, and it is met when a test or property that verifies it passes. If a `blocked-by` link names a
requirement, `naima check` notes it (the check `dependencies-wait-on-work`), and the link should wait on the work that delivers or proves the requirement
instead.

## Keep a diary

The timeline says when gates opened and when epics finished. A diary says what happened and why, day by day, and it is written as things happen.

```sh
naima event 2026-10-05 "Work on the new engine starts from its requirements" --kind diary
```

An event dated today records the moment it was written, so the events of a single day stay in order. An event written later for an earlier day gives its time
with `--at 09:30` (a local time) or a timestamp from that day, and without one it is sorted first in its day. You can read the account back like this.

```sh
naima diary --from 2026-10-05
```

```text
2026-10-05
  --:--  decision  The GIL is always off. Why: parallel calls into Python are the point.
  09:30  diary     Work on the new engine starts from its requirements
  18:40  session   main: Day one closed: the plan is entered.
```

Each decision is shown with its reason, taken from its page, and each session note is shown in full. Nothing is stored for the diary apart from those files.

The agents write diary entries on their own, without being asked, for a decision taken with you in conversation, a change in the direction of the work, or
something notable that happens outside the tracker. They write none for routine work, and none for what a session note or a decision already says, so the diary
stays short enough to read ([the rule](rules.md#agents-keep-the-diary)). `naima check` notes a day with more than five diary entries, and an entry that only
repeats a session note or a decision of its day. The number is the coordination plugin's `diaryPerDay` option in `naima-tracker/naima-data/naima.json`.

```json
"plugins": {
  "coordination": { "options": { "diaryPerDay": 3 } }
}
```

## Hold a declared list to its tests: coverage

Some lists are kept elsewhere in the project, such as the paid features in a pricing file, the API endpoints in the code, or the limits. You declare such a list
once, by saying where it is, and Naima reads it from there on every run, so there is no copy that can fall out of date. The declaration goes in
`plugins.gates.options.coverage` of `naima-tracker/naima-data/naima.json`.

```json
"coverage": {
  "paid": { "says": "the paid features", "json": "plans.json", "path": "plans.*.features" },
  "api": { "files": ["src/**/*.ts"], "pattern": "route\\(\"([^\"]+)\"" }
}
```

A JSON source names the file and where the list is inside it, with keys joined by dots and `*` for every element. An element that is an object is named by its
`id`, or by the field that `key` names. A files source names the files and a regular expression, and each match is an entry (its first group, if it has one).

A test names the entries it proves in `covers`, for example `naima set tests/sso-signs-in covers=sso`, or `paid:sso` to say which list the entry belongs to.
Then `naima coverage` shows what is covered.

```text
$ naima coverage
paid — the paid features: 2 of 3 covered
  export  tests/export-works [passed]
  sso     NO TEST
  audit   tests/audit-log [open]
```

`naima coverage --check` exits 1 as long as any entry has NO TEST. A gate can require a list, as in `naima gate new launch "Launch" --coverage paid`, and it is
then blocked by each entry with NO TEST. `naima check` notes a test whose `covers` names an entry that is no longer on the list.

## Where it lives

Epics are items, kept in `naima-tracker/naima-data/epics/`. Gates are stored under `plugins.gates.options.gates` in `naima-tracker/naima-data/naima.json`
([configuration](config.md)), which is what `naima gate new` writes, with the method a gate follows as its `method` and its own steps as its `steps`, and the
coverage lists sit next to them under `plugins.gates.options.coverage`. The timeline's records are in `naima-tracker/naima-data/events/`. All of them are
committed along with the work.
