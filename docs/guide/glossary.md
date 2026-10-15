# Glossary

This page defines every term Naima uses, once and in plain words. Other
pages link a term here the first time they use it, and [the primer](primer.md)
gives the overview of how the terms fit together. Terms are grouped by
subject, and within a group they come in the order you are likely to meet
them. Where an everyday example helps, a house renovation stands in for any
long piece of work. A term marked *planned* names something Naima doesn't
have yet ([planned](../planned.md)).

## The work

### Owner

The person whose work it is and whom the project answers to. The owner
decides what is built and judges the things only a person can judge. No
technical knowledge is needed, because the agents do the machine work
([what Naima is for](../purpose.md)).

### Repository

The folder in which git keeps every version of the work, with its whole
history. Anything kept in one, whether software, a data analysis or a paper
with colleagues, is a project Naima can track.

### Commit

One saved change in the [repository](#repository), with a message saying why.
Agents make small commits so that any single change can be found and undone
([git, handled for you](../agents/git-for-the-owner.md)).

### Claim

A statement that something is true, such as "this bug is fixed". On its own
it proves nothing, so it needs [evidence](#evidence) and a [proof](#proof)
behind it.
*Everyday example:* a plumber saying "the leak is fixed".

### Proof

A repeatable way to check a [claim](#claim), written down so someone else
can do it. It is either a [test item](#test-item) or a
[property](#property) that a tool checks. *Everyday example:* "run the tap
for a minute and check the floor stays dry".

### Epic

A body of work that groups other items. It is kept as an item of type
`epics`, and its items are linked to it with `part-of`. Its status follows
theirs, so it is open while any of them is open and done once all of them are
closed (`naima epic`, and
[plan with epics, milestones and gates](plan-with-epics-milestones-and-gates.md)).
*Everyday example:* "renovate the kitchen".

### Milestone

A [gate](#gate) with a due date, and optionally a version, created with
`naima gate new <name> "<title>" --due YYYY-MM-DD`. Naima counts the days
left, and `naima check` adds a note when one is overdue and still doesn't
hold.
*Everyday example:* "kitchen usable by 1 March".

### Requirement

Something the result must satisfy, stated so that it can be checked, and
proven by a test linked to it ([planning](plan-with-requirements-specs-and-decisions.md)). *Everyday example:* "the counter holds 50 kg".

### Specification

The precise description of how something must behave. It is kept in
numbered versions, and only one of them is current ([planning](plan-with-requirements-specs-and-decisions.md)). *Everyday example:* the plumber's drawing with every pipe size.

### Decision

A choice that belongs to the [owner](#owner), recorded with its reason so
the question isn't asked again. It is an item of its own, with a date, and
agents search the decisions before they ask anything ([planning](plan-with-requirements-specs-and-decisions.md)). *Everyday example:* "white tiles, not grey".

### Role

A job in the team of agents, defined mainly by what it refuses to do, so
that nobody checks their own work
([the company and its roles](../purpose.md#the-company-and-its-roles)).
Roles are stored as data. `naima roles` lists them, and
`naima queue --role <role>` shows one role's queue ([a role's queue](read-the-board.md#a-roles-queue)).
*Everyday example:* the inspector who signs off the wiring is never the
one who installed it.

### Formal methods

Tools that check a design mathematically, covering every case rather than
the few that a test tries.

### Model checker

A formal-methods tool that checks a design over every possible order of
events and, when the design is wrong, prints the exact steps that break it.
mCRL2 is one, and VoxLogicA checks properties of images. Naima runs one through a
[verifier](#verifier).

## The tracker

### Project

The [repository](#repository) Naima tracks, which can hold software, an
analysis, a paper, or several of these at once. Naima adds one folder,
`naima-tracker/`, at its root.

### Tracker

The folder `naima-tracker/` and what it holds, which is the
[program](#program-directory) and the [data](#data-directory). "The tracker"
also means the state it records, that is every [item](#item) and its
[links](#link).

### Data directory

`naima-tracker/naima-data/`, which holds everything the project records.
That means its items, [claim files](#claim-file),
[session notes](#session-note) and `naima.json` (the [lock](#lock) and the
[configuration](config.md)). It is committed with the project, and its
layout is fixed by [the format](../reference/format.md).

### Program directory

`naima-tracker/naima/`, the clone of Naima that the project runs. It holds
only the files that run Naima, git ignores it, and it is checked out again on
every [update](#update). None of your own files live in it.

### Item

One piece of the work written down, such as a bug, a todo, a feature, a
test, a property or a rule. An item is a directory under the data directory,
`<type>/<slug>/`, holding `README.md` (its page of text), `meta.json` (its
[fields](#field)) and `attachments/` (its [evidence](#evidence)).

### Type

The kind of an item, which is also the directory it lives in: `bugs`,
`todos`, `features`, `tests`, `properties`, `requirements`, `specs`,
`decisions`, `rules`, `epics`, and `closed` (the archive). Each type has its
own [statuses](#status). Plugins can add types, and `naima types` lists the
ones in use.

### Bug

An item of type `bugs`, for something that is broken. "Figure 3 uses last
year's data" is just as much a bug as a crash is.

### Todo

An item of type `todos`, for work that isn't a defect, such as a task, a
decision or a tidy-up. *Everyday example:* "order the tiles".

### Feature

An item of type `features`, for something the work should be able to do.
It goes from `requested` to `shipped`. *Everyday example:* "a dishwasher under the
counter".

### Status

Where an item is in its life, for example `open`, `partial`, `passed` or
`shipped`. Every status falls into one of two categories, **open** (still to
do) or **done** (settled). A status may also [prove](#proves) or
[refute](#refutes).

### Field

A named value in an item's `meta.json`, such as `status`, `priority`,
`fixedOn` or `gate`. Which fields exist depends on the loaded
[plugins](#plugin), and the [reference](../reference/reference.md) lists
every one. Fields are set with `naima set`.

### Id

An item's permanent name, a uuid such as
`5353a7eb-0fbc-4066-ae70-f65e4c3b2885`. It never changes, and it is what
[links](#link) store.

### Slug

An item's readable name, made from its title, such as
`greet-sh-says-helo-instead-hello`. Unlike the [id](#id), it may change. On
the command line an item can be
named by its id, by `type/slug`, by its slug, or by any piece of a slug that
matches exactly one item (`greet-sh-says`).

### Section

A heading an item is grouped under on its [board](#board). It is free
text, set with `--section` or `naima set <item> section=…`.

### Area

A field saying where an item lives, meaning the part of the work somebody
would have open while working on it ("export", "chapter 3", "the cleaning
script").

### Kind

A field saying what kind of work an item demands, such as code, decision,
research or writing. The kinds are the ones the [roles](#role) take, and
each one puts the item on that role's queue. Any other value is kept as a
note and is never refused.

### Announceable

A feature that may be announced because it is user-facing, shipped,
documented, and checked by a person or end to end. This is computed by
`naima announce`, never declared
([announce only what is true](announce.md)).

## Links

### Link

A typed connection from one item to another, made with `naima link`. Only
the direction you write is stored, and the reverse is worked out when the
tracker is read, so the two directions can't disagree.

### Relation

The type of a link. The relations are `verifies` / `verified-by`, `blocks` / `blocked-by`,
`part-of` / `has-part`, `specified-by` / `specifies`, `satisfies` /
`satisfied-by`, `settles` / `settled-by`, `supersedes` / `superseded-by`,
`duplicate-of` and `relates-to`, and the
[reference](../reference/reference.md) lists every one.

### Verifies

The relation from a [gesture](#gesture) (a test or a property) to the item
it proves. Its reverse is `verified-by`, which reads as "is proven by".

## From report to close

### Report

What someone says, sees or finds, written down as an item with what
happened, the evidence and the consequence ([file a bug](file-a-bug.md)). An
agent writes it in its own words, and copies the owner's own words only if
the owner says yes ([the rule](rules.md#the-owners-chat-stays-private)).

### Triage

What an agent does to a report once it is filed. It rewrites the report as
a clear description, links any duplicates, and sets the four fields that
rank it, which are [impact](#impact), [priority](#priority),
[confidence](#confidence) and [effort](#effort) ([triage](triage.md)).

### Impact

A triage field that says who would notice if nobody touched the item. The
values are `blocker` (stops a release or loses work), `high` (a newcomer
would hit it and not come back), `medium` (noticeable, but can be worked
around) and `low` (cosmetic).

### Priority

A triage field that says when the item should be dealt with: `now`,
`next`, `later` or `parked`.

### Deferral

An item with `priority=parked`, a bug set to `wontfix` or a todo set to
`dropped`. It is deliberately not being worked on for now, and the reason is
on its page. See
[reopensWhen](#reopenswhen) and [`naima view parked`](triage.md).

### ReopensWhen

A field on a deferral that says what would make it worth discussing again,
either in words or as a link to the item or document that would. If it isn't
set, the deferral tends to get argued over again, without anyone saying so,
the next time someone notices it.

### Confidence

A triage field that says how well the problem is understood: `measured`,
`diagnosed`, `reported` or `unclear`.

### Effort

A triage field that says what the work costs: `S` (under an hour), `M`
(half a day), `L` (a day or two) or `XL` (more, or unknown). It is set only
by someone who has looked at the work to be done, and never guessed.

### Urgency

The "most urgent first" order used in every list. It is worked out from
the triage fields and the [gates](#gate) an item is on, and it is never
stored.

### Fixed

The change exists, whether it is code, a corrected table or a rewritten
paragraph, and the item's `fixedOn` field is set. Nothing has been proven
yet.

### Gesture

What someone does to prove a claim, such as running a command, opening a
screen and looking, or measuring something. It is written as a
[test item](#test-item) so that anyone can carry it out later.

### Test item

An item of type `tests`, holding a [gesture](#gesture) and its result. It
is linked with `verifies` to what it proves. Its status `passed`
[proves](#proves), and `failed` [refutes](#refutes).

### Property

An item of type `properties`, holding a statement about the work, or about
a model of it, that a [verifier](#verifier) checks. `holds` proves, and
`violated` refutes.

### Proves

A status that counts as evidence for what the item [verifies](#verifies),
namely `passed` or `holds`.

### Refutes

A status that counts as evidence against what the item verifies, namely
`failed` or `violated`. A single refuting item outweighs any number of items
that prove.

### Resolved

[Fixed](#fixed) and proven. An item that verifies it is in a status that
proves, and nothing that verifies it refutes.

### Closed

Resolved, and moved by `naima close` into the archive, `closed/`, together
with its proof, so that a regression can be recognised if it comes back.

### Evidence

What backs a claim, such as a log line, a number, a screenshot or a
command's output, kept in the item's `attachments/`. Saying "it works"
without any of it is not a proof. From strongest to weakest, evidence is the
owner's own gesture, then a screenshot, log line or number, then the live
state read by tooling, then a before-and-after comparison, and finally "the
code looks right", which proves nothing. A number always comes with what it
is compared against.

### Evidence kind

The field `evidenceKind` on a test, which says what rank of
[evidence](#evidence) it carries: `owner-gesture`, `observation`,
`live-read`, `diff` or `inspection`.

### Red, then green

A regression test proves a fix only if it was seen failing on the code
before the fix and then passing on the fixed code. The field `redSeen`
records the day it was seen failing.

### Run by

The field `runBy`, which says who has to carry out the proving gesture.
The values are `agent` (a command settles it), `agent-hands` (an agent
driving the running software), `human` (only a person can) and `build` (an
artefact nobody here makes).

### Human because

The field `humanBecause`, which says why only a person can carry out a
gesture marked `runBy: human`. The values are `judgement`, `decision`,
`credential` and `physical`
([what is genuinely the owner's](../agents/asking-the-human.md#what-is-genuinely-the-owners)).

### Beta marker

A comment in the project's own source, `naima:beta <item> <what>`, that
marks behaviour shipped without proof and names the item whose passing would
prove it. `naima beta` lists them, and `naima check` fails on one that names
nothing or is still there after its proof has passed.

## Seeing where things stand

### Board

The items of one type, grouped by [section](#section) with the most urgent
first, as shown by `naima board bugs`.

### Gate

A condition a release waits on, made of a named list of items that must be
done first. *Everyday example:* "we move in only when the water and the power
have been signed off". An item joins a gate by carrying `gate: <name>`, and
the gate **holds** when nothing on it is in the way. With `holdsOn: "code"`
it waits for the code but not the proof, and with `holdsOn: "proof"` it
waits for every open item ([read the board, the queue and the gates](read-the-board.md)).

### Metric

A name and the command that measures it, for example test time, coverage,
warnings or how long an analysis runs, or else a code-quality number that
Naima measures itself (lines of code, complexity, duplication). It is
recorded on every commit, held to a budget, a floor or a baseline, and read
back over the commit timeline with `naima metrics`
([metrics and budgets](metrics-and-budgets.md)).

### Queue

The open items on a gate, split by who has to carry out their proof, as
shown by `naima queue`.

### Summary

Where the project stands, on one screen, as shown by `naima summary`.

### Check

A [rule](#rule) that a program enforces, so nobody has to remember it.
Each check is one rule that `naima check` holds the tracker to. *Everyday
example:* a till that won't print the bill until the job is marked "seen
working". A check reports either a **problem**, which makes `naima check`
fail, or a **note**, which doesn't. A project can set each check to
`problem`, `note` or `off` ([configuration](config.md#check-severity)).

### Waiver

A recorded exemption from one problem that a [check](#check) reports on one
subject, written by `naima waive` with its reason, who gave it and when. The
waived problem no longer fails `naima check`, which lists the waiver as a
note instead ([the rule](rules.md#a-finding-is-fixed-or-waived-with-its-reason)).

### Invariant

What a check holds true. When every invariant holds, `naima check` ends
with `all invariants hold`.

### Write hook

A rule that runs on every change to an item and can refuse the change, for
example a branch closing items it has claimed itself, or a property set to
`holds` by hand. Editing `meta.json` by hand bypasses write hooks, so every
write hook that protects a state of the tracker has a matching
[check](#check) that `naima check` runs on the tracker as it is.

### Event

Something that happened which Naima can't work out from the items and git,
such as a decision taken in a meeting, a build handed out, or an outside
fact. It is recorded as one file by
`naima event <date> "<what>" --kind <kind>`. Everything else on the timeline
(`naima view timeline`) is worked out automatically
([the timeline](plan-with-epics-milestones-and-gates.md#see-when-things-happened-the-timeline)).

### Diary

The project's story, day by day. It is made of the [events](#event) of
kind `diary`, every decision with its reason, and every
[session note](#session-note), and `naima diary` tells it in order
([keep a diary](plan-with-epics-milestones-and-gates.md#keep-a-diary)).

### Derived

Computed when asked for and never written down. Boards, queues, gate
states, urgency and summaries are all derived, so there is no stored copy
that could go out of date.

## Working in parallel

### Branch

A line of work in git. Each piece of work has its own branch.

### Trunk

The branch that releases come from, usually `main`.

### Worktree

A private copy of the project in which one agent works, so that it can't
disturb anyone else. It is a second checkout of the same repository, in its
own folder and on its own branch. *Everyday example:* a draft on your own
desk rather than on the shared one. Each piece of work gets its own worktree,
so sessions running in parallel never write to each other's files ([work on several branches at once](several-branches.md)).

### Fast-forward

A merge that only moves a branch forward onto another without adding a
merge commit, done with `git merge --ff-only <branch>`. It succeeds only when
the branch already contains the other. A branch that is ready to land can be
fast-forwarded, because it contains the trunk, but it still lands as a
[marker](#marker) rather than as a fast-forward.

### Landing

A branch entering the trunk. The [coordinator](#coordinator) does it with
`naima land <branch>`, or it can be done by hand with the same git commands.
Every landing closes at least one item and leaves one [marker](#marker) on
the trunk
([the rule](rules.md#every-landing-is-a-marker-naming-the-items-it-closes)).

### Marker

The commit a [landing](#landing) leaves on the trunk. It is a merge whose
first parent is the trunk before it and whose second parent is the branch
tip. Its tree is the branch tip's, and its message is `Land <branch>` with
one `Closes: <item id>` trailer for each item it closes. Following the
trunk's first parents gives a list of markers, and `M^1..M^2` lists the
commits that marker `M` landed.

### Run

A long command started by `naima run`. It has a name, keeps going
independently of the session that started it, and is limited by a time
budget (plus a disk budget on the files it declares it creates). It has a
log, a progress file and a record in `naima-tracker/.runs/`. `naima wait`
waits for it, and `naima run clean` removes what it created ([long work](long-work.md)).

### Claim file

A note that a branch is working on some items. `naima claim` writes it as
a file of its own in `claims/`, and `naima release` removes it. Claim files
are read from every local branch, so everyone can see who holds what
(`naima claims`). It is not the same thing as a [claim](#claim), which is a
statement that something is true.

### Session note

A note of what a session changed, what it proved and what it left to do,
written by `naima pass` as a file of its own in `passes/`. `naima summary`
shows the newest one.

## Running Naima

### Naima

The tracker itself, and the command that runs it. `naima <command>` is
short for `deno run -A naima-tracker/naima/naima.ts <command>`.

### Deno

The program that runs Naima's code. It is the one thing installed on the
machine, and it is installed once ([install](install.md#deno-once-per-machine)).

### Launcher

`naima-tracker/naima/naima.ts`, the file every `naima` command starts
from. It lets the program read the project, write only inside
`naima-tracker/`, and run only `git` and the tools its plugins declare
([the permissions](install.md#the-permissions)).

### Source

Where the project's copy of Naima comes from. It is a git repository,
either Naima's own on GitHub (the default) or a [fork](#fork), and it is
recorded in `naima.json`.

### Lock

The `source` and `commit` in `naima.json`, which say exactly which Naima
runs the project. Everyone who works on the project runs that one.

### Alignment

What every run does first, which is to make the program directory match
the locked commit exactly, copying it if it is missing. It never overwrites
work and never pulls.

### Clone

What a project's program directory is, namely a git clone of Naima's own
repository checked out at the locked commit. It doesn't include Naima's tests
or its own tracker, which live in a separate, private repository called the
workshop
([the clone](install.md#the-clone)).

### Update

Moving the [lock](#lock) to a newer Naima with `naima update`, which gives
one commit to review ([update Naima](update-naima.md)).

### Format

The version number of the data's layout, kept in `naima.json`. It changes
only through a [migration](#migration).

### Migration

The step that rewrites the data from one [format](#format) to the next.
`naima update` runs it, and it only goes forward.

### Fork

Your own copy of Naima's repository, changed to suit the project. A
project runs it by naming it as its [source](#source)
([modifying Naima](install.md#modifying-naima)).

## Plugins

### Plugin

A piece of Naima that adds item types, fields, checks, commands, gates or
views. Almost everything in Naima is a plugin, and the small core only loads
them.

### First-party plugin

A plugin that ships with Naima: `trackers`, `coordination`, `triage`,
`gates`, `beta-markers`, `verifier`, `docs` and `rules`. All of them are on
unless the project switches one off.

### Third-party plugin

A plugin from anywhere else, such as a colleague or another repository. It
is added in `naima.json` and pinned so that only the code you reviewed runs
([add a plugin someone gave you](add-a-plugin.md)).

### Verifier

An adapter that connects Naima to a formal-methods tool, such as a model
checker. `naima verify` runs it on a [property](#property) and attaches the
run as evidence.

### Manifest

What a plugin declares about itself and about each thing it adds,
including the documentation. The [reference](../reference/reference.md) is
generated from the manifests.

## Agents

### Agent

An AI that works on the project. It reads items, writes code, runs checks
and files what it finds ([working with AI agents](working-with-agents.md)).

### Skill

A page an agent tool loads to learn how to work with Naima, which is
`skills/naima/SKILL.md` in the program directory
([the Naima skill](../agents/skill.md)).

### Flow

A written procedure that an agent, or a person, follows step by step for
one kind of work, such as reporting, opening a worktree or closing.
*Everyday example:* the checklist a pilot runs before take-off.
[How the project runs](how-the-project-runs.md) shows how the flows fit
together, and [the pages for agents](../agents/README.md) hold the
procedures.

### Coordinator

In a session staffed with several agents, the one that talks to the owner
and hands work to the workers. It doesn't do the work itself.

### Worker

An agent doing one piece of work, in its own worktree and on its own
branch.

### Session

One stretch of work by one agent, from when it starts to when it stops.
Each session leaves a [session note](#session-note), and the next one starts
from the files rather than from memory.

### Rule

Something the project always sticks to, along with the reason for it. The
rules that apply to every project are written once on
[the rules page](rules.md), each marked as either checked by Naima or kept
by convention. A project's own rules are items of type `rules` ([write a project rule](write-a-project-rule.md)). *Everyday
example:* "no job is paid until the owner has seen it work".
