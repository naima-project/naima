# Glossary

Every term Naima uses, defined once, in plain words. Every other page links
its terms here the first time it uses them. Terms are grouped by subject;
within a group, the order is the order you meet them in. Where an everyday
example helps, a renovation stands in for any long piece of work. A term
marked *planned* names something Naima does not have yet
([planned](../planned.md)).

## The work

### Owner

The person whose work it is and whom the project answers to: the one who
decides what is built and judges what only a person can judge. The owner
needs no technical knowledge; agents do the machine work
([what Naima is for](../purpose.md)).

### Repository

The folder in which git keeps every version of the work, with its whole
history. Software, a data analysis, a paper with colleagues: anything kept
in one is a project Naima can track.

### Commit

One saved change in the [repository](#repository), with a message saying why.
Agents make small commits, so any single change can be found and undone
([git, handled for you](../agents/git-for-the-owner.md)).

### Claim

A statement that something is true, such as "this bug is fixed". On its own
it proves nothing; [evidence](#evidence) and a [proof](#proof) back it.
*Everyday example:* a plumber saying "the leak is fixed".

### Proof

A repeatable way to check a [claim](#claim), written so someone else can do
it: a [test item](#test-item), or a [property](#property) a tool checks.
*Everyday example:* "run the tap for a minute; the floor must stay dry".

### Epic

*Planned.* A large goal made of many features and todos, kept as one item.
*Everyday example:* "renovate the kitchen".

### Milestone

*Planned.* A [gate](#gate) with a date. Naima's own items do not use them
yet. *Everyday example:* "kitchen usable by 1 March".

### Requirement

Something the result must satisfy, stated so it can be checked, and proven
by a test linked to it ([planning](plan-with-requirements-specs-and-decisions.md)). *Everyday example:* "the counter holds 50 kg".

### Specification

The precise description of how something must behave, kept in numbered
versions: only one is current ([planning](plan-with-requirements-specs-and-decisions.md)). *Everyday example:* the plumber's drawing with every pipe size.

### Decision

A choice that is the [owner](#owner)'s, recorded with its reason so it is
never asked again: an item of its own, dated, searched by agents before they
ask anything ([planning](plan-with-requirements-specs-and-decisions.md)). *Everyday example:* "white tiles, not grey".

### Role

A job in the team of agents, defined mainly by what it refuses to do, so no
one marks their own homework
([the company and its roles](../purpose.md#the-company-and-its-roles)).
Roles are data: `naima roles` lists them, and `naima queue --role <role>`
is one's queue ([a role's queue](read-the-board.md#a-roles-queue)).
*Everyday example:* the inspector who signs off wiring never installs it.

### Formal methods

Tools that check a design mathematically, over every case rather than the
few a test tries.

### Model checker

A formal-methods tool that checks a design over every possible order of
events and, when the design is wrong, prints the exact steps that break it.
mCRL2 is one; VoxLogicA checks properties of images. Naima runs one through a
[verifier](#verifier).

## The tracker

### Project

The [repository](#repository) Naima tracks — software, an analysis, a paper,
or several at once — with one folder, `naima-tracker/`, added at its root.

### Tracker

The folder `naima-tracker/` and what it holds: the [program](#program-directory)
and the [data](#data-directory). "The tracker" also means the state it
records: every [item](#item) and its [links](#link).

### Data directory

`naima-tracker/naima-data/`: everything the project records — its items,
[claim files](#claim-file), [session notes](#session-note) and `naima.json` (the
[lock](#lock) and the [configuration](config.md)). It is committed with the
project. Its layout is fixed by [the format](../reference/format.md).

### Program directory

`naima-tracker/naima/`: the clone of Naima the project runs. It holds only
the files that run Naima, is ignored by git, and is checked out anew on every
[update](#update). Nothing of yours lives in it.

### Item

One piece of the work written down: a bug, a todo, a feature, a test, a
property, a rule. An item is a directory under the data directory, `<type>/<slug>/`, holding
`README.md` (its page: the prose), `meta.json` (its [fields](#field)) and
`attachments/` (its [evidence](#evidence)).

### Type

The kind of an item, and the directory it lives in: `bugs`, `todos`,
`features`, `tests`, `properties`, and `closed` (the archive). Each type has
its own [statuses](#status). Plugins can add types; `naima types` lists those
in use.

### Bug

An item of type `bugs`: something that is broken. "Figure 3 uses last year's
data" is a bug as much as a crash is.

### Todo

An item of type `todos`: work that is not a defect — a task, a decision, a
tidy-up. *Everyday example:* "order the tiles".

### Feature

An item of type `features`: something the work should be able to do, from
`requested` to `shipped`. *Everyday example:* "a dishwasher under the
counter".

### Status

Where an item is in its life: `open`, `partial`, `passed`, `shipped`… Every
status is in one of two categories, **open** (still to do) or **done**
(settled). A status may also [prove](#proves) or [refute](#refutes).

### Field

A named value in an item's `meta.json`: `status`, `priority`, `fixedOn`,
`gate`… Which fields exist depends on the loaded [plugins](#plugin); the
[reference](../reference/reference.md) lists every one. Set them with
`naima set`.

### Id

An item's permanent name, a uuid such as
`5353a7eb-0fbc-4066-ae70-f65e4c3b2885`. It never changes, and [links](#link)
hold it.

### Slug

An item's readable name, made from its title: `greet-sh-says-helo-instead-hello`.
It may change; the [id](#id) does not. On the command line an item can be
named by its id, by `type/slug`, by its slug, or by any piece of a slug that
matches exactly one item (`greet-sh-says`).

### Section

A heading an item is grouped under on its [board](#board). Free text, set with
`--section` or `naima set <item> section=…`.

### Area

A field: where an item lives — the part of the work somebody would have open
while working on it ("export", "chapter 3", "the cleaning script").

### Kind

A field: the mode of work an item demands — code, decision, research,
writing. The kinds are those the [roles](#role) take, each putting the item
on a role's queue; any other is a note, never refused.

### Announceable

A feature that may be announced: user-facing, shipped, documented, and
checked by a person or end to end. Computed, never declared:
`naima announce` ([announce only what is true](announce.md)).

## Links

### Link

A typed connection from one item to another, made with `naima link`. Only the
direction written is stored; the reverse is worked out when read, so the two
can never disagree.

### Relation

The type of a link: `verifies` / `verified-by`, `blocks` / `blocked-by`,
`duplicate-of`, `relates-to`.

### Verifies

The relation from a [gesture](#gesture) (a test or a property) to the item it
proves. Its reverse is `verified-by`, read "is proven by".

## From report to close

### Report

What someone says, sees or finds, written as an item: what happened, the
evidence, the consequence ([file a bug](file-a-bug.md)). An agent writes it
in its own words; the owner's own words are copied only with the owner's
yes ([the rule](rules.md#the-owners-chat-stays-private)).

### Triage

What an agent does to a report once it is filed: rewrites it as a clear
description, links duplicates, and sets the four fields that rank it: [impact](#impact),
[priority](#priority), [confidence](#confidence) and [effort](#effort)
([triage](triage.md)).

### Impact

A triage field: if nobody touches this, who notices? `blocker` (stops a
release or loses work), `high` (a newcomer would hit it and not come back),
`medium` (noticeable, worked around), `low` (cosmetic).

### Priority

A triage field: when. `now`, `next`, `later`, `parked`.

### Deferral

An item with `priority=parked`, or a bug `wontfix` or a todo `dropped`:
deliberately not being worked on now, with the reason on its page. See
[reopensWhen](#reopenswhen) and [`naima view parked`](triage.md).

### ReopensWhen

A field on a deferral: what would make it worth re-arguing, as prose or a
link to the item or document that would. Unset, a deferral is silently
re-argued the next time someone notices it.

### Confidence

A triage field: do we understand it? `measured`, `diagnosed`, `reported`,
`unclear`.

### Effort

A triage field: what it costs, `S` (under an hour), `M` (half a day), `L` (a
day or two), `XL` (more, or unknown). Set only by someone who has looked at
the work to be done, never guessed.

### Urgency

The order "most urgent first" in every list, worked out from the triage
fields and the [gates](#gate) an item is on. Never stored.

### Fixed

The change exists — the code, the corrected table, the rewritten paragraph:
the item's `fixedOn` field is set. Nothing is proven yet.

### Gesture

What someone does to prove a claim: run a command, open a screen and look,
measure. Written as a [test item](#test-item) so anyone can perform it later.

### Test item

An item of type `tests`: a [gesture](#gesture) and its result. Linked
`verifies` to what it proves. Its status `passed` [proves](#proves), `failed`
[refutes](#refutes).

### Property

An item of type `properties`: a statement about the work, or about a model
of it, checked by a [verifier](#verifier). `holds` proves, `violated` refutes.

### Proves

A status that counts as evidence for what the item [verifies](#verifies):
`passed`, `holds`.

### Refutes

A status that counts as evidence against what the item verifies: `failed`,
`violated`. One refuting item outweighs any number that prove.

### Resolved

[Fixed](#fixed), and proven: an item that verifies it is in a status that
proves, and nothing verifying it refutes.

### Closed

Resolved, and archived by `naima close` into `closed/`, carrying its proof, so
a regression is recognised when it comes back.

### Evidence

What backs a claim: a log line, a number, a screenshot, a command's output,
kept in the item's `attachments/`. "It works" without it is not a proof.
Ranked, strongest first: the owner's own gesture; a screenshot, log line or
number; the live state read by tooling; a before-and-after comparison; and
"the code looks right", which proves nothing. No number without its
comparison.

### Evidence kind

The field `evidenceKind` on a test: which rank of [evidence](#evidence) it
carries — `owner-gesture`, `observation`, `live-read`, `diff` or `inspection`.

### Red, then green

A regression test proves a fix only if it was seen failing on the code before
the fix, then passing on the fix. The field `redSeen` records the day it was
seen red.

### Run by

The field `runBy`: whose hands the proving gesture needs. `agent` (a command
settles it), `agent-hands` (an agent driving the running software), `human`
(only a person), `build` (an artefact nobody here makes).

### Human because

The field `humanBecause`: why only a person can perform a gesture marked
`runBy: human`. `judgement`, `decision`, `credential` or `physical`
([what is genuinely the owner's](../agents/asking-the-human.md#what-is-genuinely-the-owners)).

### Beta marker

A comment in the project's own source, `naima:beta <item> <what>`, that marks
behaviour shipped without proof and names the item whose passing would prove
it. `naima beta` lists them; `naima check` fails on one that names nothing or
outlives its proof.

## Seeing where things stand

### Board

A type's items grouped by [section](#section), most urgent first:
`naima board bugs`.

### Gate

A condition a release waits on: a named list of items that must be done
first. *Everyday example:* "we move in only when water and power are signed
off". It is backed by items: an item joins it by
carrying `gate: <name>`. A gate **holds** when nothing on it blocks.
`holdsOn: "code"` waits for code, not proof; `holdsOn: "proof"` waits for
every open item ([read the board, the queue and the gates](read-the-board.md)).

### Metric

A name and the command that measures it — test time, coverage, warnings,
how long an analysis runs — or a code-quality number Naima takes itself
(lines of code, complexity, duplication), recorded per commit, held to a
budget, a floor or a baseline, and read back over the commit timeline:
`naima metrics` ([metrics and budgets](metrics-and-budgets.md)).

### Queue

The open items on a gate, split by whose hands their proof needs:
`naima queue`.

### Summary

Where the project stands, in one screen: `naima summary`.

### Check

A [rule](#rule) a program enforces, so nobody has to remember it: one rule
`naima check` holds the tracker to. *Everyday example:* a till that will not
print the bill until the job is marked "seen working". A check reports a **problem**,
which fails `naima check`, or a **note**, which does not. A project can weigh
each check `problem`, `note` or `off` ([configuration](config.md#check-severity)).

### Invariant

What a check holds true. `naima check` ends with `all invariants hold` when
every one does.

### Write hook

A rule run on every change to an item, which can refuse it: a branch closing
its own claimed items, a property set to `holds` by hand. A hand edit of
`meta.json` never meets a write hook, so each one that protects a state of the
tracker has a [check](#check) counterpart that `naima check` runs on the
tracker as it is.

### Derived

Computed when asked and never written down: boards, queues, gate states,
urgency and summaries. No stored copy can go stale.

## Working in parallel

### Branch

A line of work in git. Each piece of work has its own.

### Trunk

The branch releases come from, usually `main`.

### Worktree

A private copy of the project in which one agent works, so it cannot disturb
anyone else: a second checkout of the same repository, in its own folder,
standing on its own branch. *Everyday example:* a draft on your own desk, not
on the shared one. One worktree per piece of work, so parallel sessions never write
to one another's files ([work on several branches at once](several-branches.md)).

### Fast-forward

A merge that only moves the trunk forward onto the branch, adding no merge
commit: `git merge --ff-only <branch>`. It succeeds only when the branch
already contains the trunk.

### Run

A long command started by `naima run`: named, detached from the session that
started it, bounded by a time budget (and a disk budget on what it declares
it creates), with a log, a progress file and a record in
`naima-tracker/.runs/`. `naima wait` waits for it, `naima run clean` removes
what it created ([long work](long-work.md)).

### Claim file

A note that a branch is working on some items, written by `naima claim` as one
file of its own in `claims/`, and dropped by `naima release`. Claim files are
read from every local branch, so everyone sees who holds what (`naima
claims`). Not to be confused with a [claim](#claim), a statement that
something is true.

### Session note

A note of what a session changed, proved and left, written by `naima pass` as
one file of its own in `passes/`. `naima summary` shows the newest.

## Running Naima

### Naima

The tracker itself, and the command that runs it: `naima <command>`, short for
`deno run -A naima-tracker/naima/naima.ts <command>`.

### Deno

The program that runs Naima's code. The one thing installed on the machine,
once ([install](install.md#deno-once-per-machine)).

### Launcher

`naima-tracker/naima/naima.ts`, the file every `naima` command starts from. It
lets the program read the project, write only inside `naima-tracker/`, and run
only `git` and the tools its plugins declare
([the permissions](install.md#the-permissions)).

### Source

Where the project's copy of Naima comes from: a git repository, Naima's own on
GitHub by default, or a [fork](#fork). Recorded in `naima.json`.

### Lock

The `source` and `commit` in `naima.json`: exactly which Naima runs the
project. Everyone who works on the project runs that one.

### Alignment

What every run does first: make the program directory exactly the locked
commit, copying it when it is missing. It never overwrites work and never
pulls.

### Clone

What a project's program directory is: a git clone of Naima's own
repository, checked out at the locked commit — without its tests or its own
tracker, which live in a separate repository,
[`naima-dev`](https://github.com/vincenzoml/naima-dev)
([the clone](install.md#the-clone)).

### Update

Moving the [lock](#lock) to a newer Naima: `naima update`, as one commit to
review ([update Naima](update-naima.md)).

### Format

The version number of the data's layout, in `naima.json`. It moves only with a
[migration](#migration).

### Migration

The step that rewrites the data from one [format](#format) to the next, run by
`naima update`, forward only.

### Fork

Your own copy of Naima's repository, changed to fit the project. A project
runs it by naming it as its [source](#source)
([modifying Naima](install.md#modifying-naima)).

## Plugins

### Plugin

A piece of Naima that adds item types, fields, checks, commands, gates or
views. Almost everything is a plugin; the small core only loads them.

### First-party plugin

A plugin that ships with Naima: `trackers`, `coordination`, `triage`,
`gates`, `beta-markers`, `verifier`, `docs`, `rules`. All are on unless the project
switches one off.

### Third-party plugin

A plugin from anywhere else — a colleague, another repository — added in
`naima.json` and pinned so that only the reviewed code runs
([add a plugin someone gave you](add-a-plugin.md)).

### Verifier

An adapter to a formal-methods tool, such as a model checker. `naima verify`
runs it on a [property](#property) and attaches the run as evidence.

### Manifest

What a plugin declares about itself and each thing it adds, documentation
included. The [reference](../reference/reference.md) is generated from the
manifests.

## Agents

### Agent

An AI that works on the project: reads items, writes code, runs checks, files
what it finds ([working with AI agents](working-with-agents.md)).

### Skill

A page an agent tool loads to learn how to work with Naima:
`skills/naima/SKILL.md` in the program directory
([the Naima skill](../agents/skill.md)).

### Flow

A written procedure an agent, or a person, follows step by step for one kind
of work: reporting, opening a worktree, closing. *Everyday example:* the
checklist a pilot runs before take-off. How they fit together:
[how the project runs](how-the-project-runs.md); the procedures:
[the pages for agents](../agents/README.md).

### Coordinator

In a session staffed with agents, the one that talks to the owner and hands
work to the workers; it does not do the work itself.

### Worker

An agent doing one piece of work, in its own worktree, on its own branch.

### Session

One stretch of work by one agent, from when it starts to when it stops. A
session leaves a [session note](#session-note); the next one starts from the
files, not from memory.

### Rule

Something the project always holds to, with its reason. The rules every
project holds to are written once on [the rules page](rules.md), each marked
checked by Naima or kept by convention; a project's own rules are items of
type `rules` ([write a project rule](write-a-project-rule.md)). *Everyday
example:* "no job is paid until the owner has seen it work".
