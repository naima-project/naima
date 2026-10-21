# Rules

These are the rules that every project using Naima follows, and they apply to people and [agents](glossary.md#agent) alike. This page is the only place they are
written down. The [flows](glossary.md#flow), the skill and every other page link here rather than repeating them.

Each rule is marked in one of two ways:

- **enforced by** means a [check](glossary.md#check) of `naima check`, a [write hook](glossary.md#write-hook) or a command that refuses, so Naima stops you when
  the rule is broken.
- **convention** means nothing stops you. The project keeps the rule by habit, and the linked page explains how.

The [reference](../reference/reference.md) lists every check and how it decides. Rules that only apply to developing Naima itself are in Naima's own
`AGENTS.md`, not here, and [a project's own rules](#a-projects-own-rules) are stored as data in its tracker.

A rule's reason is a different thing from the history of the documentation. The principle "Documentation states what is, never how it came to be" applies to
product pages, such as the guide, the reference or a feature's own page, and none of those tell the story of why a decision was made. Rules are deliberately
treated differently. Every rule on this page carries its reason, because the reason is part of the rule: it's how you judge whether the rule still applies once
the situation changes. So a rule's reason stays here, with the rule, and isn't repeated as history on a product page.

## The tracker

### Change the tracker only through the CLI

Items are created, changed, linked and closed with `naima` commands, never by editing `meta.json` by hand. An item's page, `README.md`, is written with
`naima describe` (the description) and `naima note` (a dated, attributed, append-only note), although a person may also write it as a file. **Enforced by** the
checks `readable`, `identity`, `fields` and `links`, which fail on what a hand edit typically breaks. Every write hook that protects a state also has a check
counterpart (`property-evidence` for `holds-only-by-verify` and `property-reopens-when-changed`, `closed-not-claimed` for `no-closing-own-claims`, `epics` for
`epic-status`), so a hand edit that a command would have refused fails `naima check`. The hooks that guard a move rather than a state (`status-moves`,
`notes-append-only`) and the ones that only fill in a value (`triage-stamps-its-date`, `planning-stamps`) have no counterpart. The rest is convention.

### Run `naima check` before every commit

**Convention**, kept by the project's own CI when it runs `naima check`.

### A finding is fixed, or waived with its reason

When `naima check` reports a problem, you fix it. Sometimes the fix would do more harm than the problem. A session note written without its acknowledgement line
is an example: notes are never edited, and adding the line afterwards would record something that did not happen. In that case you waive the finding instead:

```sh
naima waive session-note-ack passes/<file>.md --reason "<why it is accepted>"
```

This writes one file under `waivers/` in the tracker. The file names the check, the subject of the finding, the reason, who waived it (`--as`, or the first part
of the branch name) and the day. You commit it like any other change to the tracker. From then on the finding no longer fails `naima check`, but every run still
lists the waiver as a note, so it never goes out of sight. When the subject is gone, or no longer fails the check, the waiver is noted as waiving nothing, and
you can remove it.

Only a check that names the subject of its findings can be waived. Today those are `session-note-ack` and the checks of
[a change to a model is proved, not just checked](#a-change-to-a-model-is-proved-not-just-checked).

Why: a check that can't be satisfied without falsifying the record leaves two bad choices, editing the record or living with a red `naima check` that everyone
learns to ignore. A waiver is the third choice, and since it carries its reason and stays visible, it can be questioned later. **Enforced by** the command
`naima waive`, which refuses a waiver without a reason, for a check that isn't loaded, for a subject the check reports nothing on, or for a finding that is
already waived.

### Write it down before fixing it

A defect, a task or a request becomes an [item](glossary.md#item) first, and only then gets worked on, because a fix that leaves no trace has to be diagnosed
from scratch the next time. **Convention**: [file a bug](file-a-bug.md).

### Triage what you touch

When you open, report or fix an item, you leave it with [impact](glossary.md#impact), [priority](glossary.md#priority) and [confidence](glossary.md#confidence)
set. **Convention**. `naima triage` shows the coverage and `naima triage missing` shows what still lacks [effort](glossary.md#effort) ([triage](triage.md)).

### Effort is never guessed

Only someone who has looked at the work to be done sets `effort`. **Convention**. No tool infers it, and `naima triage derive` never touches it.

### Fixed, resolved and closed are three states

[Fixed](glossary.md#fixed) (the change exists), [resolved](glossary.md#resolved) (fixed and proven) and [closed](glossary.md#closed) (resolved and archived) are
kept apart and never added into one number. **Enforced by** `naima close`, which refuses anything that isn't resolved, and by the checks `closed-carries-proof`
(every archived item carries a passed [proof](glossary.md#proof)) and `proven-but-open` (a note about an open item whose proof has passed and which is ready to
close).

### Every fix names the gesture that proves it

A fixed item is [verified by](glossary.md#verifies) a [test item](glossary.md#test-item) or a [property](glossary.md#property). **Enforced by** the check
`fix-names-its-gesture`, as a note, so it reports but never fails ([prove and close](prove-and-close.md)).

### A proof is current, and evidence against it wins

An item can't be closed if its verifying item [refutes](glossary.md#refutes) it, or if `naima check` reports its proof as no longer current (a property run on a
model, a file the model includes, or a tool version that has changed since). **Enforced by** `naima close` and the check `property-evidence`. A property becomes
`holds` only through `naima verify` (the write hook `holds-only-by-verify`).

A release waits for the whole project to be current: every property holding on a run of what the project has now, and every test suite passing on the current
commit. A suite too long for that is never started on a clock: it becomes a long run that is due, and runs when the owner says so
([nothing runs unattended](#nothing-runs-unattended)). Why: a release is the one moment nothing may be out of date. **Enforced by** a gate declared
`--full-suite` ([a release gate](read-the-board.md#a-release-gate-waits-for-the-full-suite)).

### Evidence travels with the claim

Saying "it works" without a number, a log line or an attachment is not a proof. [Evidence](glossary.md#evidence) goes in the item's `attachments/`, added with
`naima attach`. **Convention**, except for properties, whose runs `naima verify` attaches itself.

### Evidence is ranked, and no number stands without its comparison

From strongest to weakest, evidence is the owner performing the gesture, then a screenshot, a log line or a number, then the live state read by tooling, then a
before-and-after comparison, and last "the code looks right", which proves nothing. A test names its rank in `evidenceKind`. A number only proves something when
it sits beside the value it is compared with. **Enforced by** the check `inspection-proves-nothing`, as a note. The rest is **convention**
([prove and close](prove-and-close.md#3-perform-it-keep-the-evidence)).

### A regression test is seen red before it is green

A test that verifies a bug was run on the code before the fix and failed, then on the fix and passed. `redSeen` records the day it failed. **Enforced by** the
check `regression-test-saw-red`, as a note.

### Test suites are recorded test by test, at the end of a phase

A project's test suites are declared, and recorded with `naima metrics run --record` at the end of a phase of work, when a branch lands, and in the release run
of the full suite or a long run the owner starts, never after every edit. Each run is kept per test, with the commit, a digest of what it read and its log, and
a test item gets its result from the run of the tests it names. A run whose inputs are unchanged is reused rather than repeated. A gate or a milestone that says
the tests pass stands on the recorded run. **Enforced by** the gate `suites` and the check `test-suites`, as a note for a test item whose names match no test.
When to record is **convention** ([metrics and budgets](metrics-and-budgets.md#record-the-test-suites-test-by-test)).

Why: when suites were recorded only as pass counts, most test items carried no evidence that they had ever run, and a milestone's "tests pass" rested on a
commit message that nobody could check later.

### Performance requirements are metrics with budgets

A requirement about how long something takes, how much memory it uses, how much it handles per second or how big something is, is measured by a metric with a
budget that names it in `satisfies`, so it is measured on every recorded run and shown over time. **Enforced by** the check
`performance-requirement-has-metric`, as a note on a requirement that names such a measure with no metric, and the check `metric-satisfies`
([metrics and budgets](metrics-and-budgets.md#performance-requirements-are-metrics-with-budgets)).

Why: a performance requirement checked once, by hand, says nothing about the version that ships, and timings that live only in benchmark files are never
compared with the ones before.

### A change to a model is proved, not just checked

When a model changes because of an item (a bug, a todo or a feature), the property linked to that item shows that the change made a difference. It is run on the
model before the change, where it is violated and its counterexample is kept, and on the changed model, where it holds. Naima keeps every run of a property, so
both runs stay with it ([proving a change to a model](prove-and-close.md#proving-a-change-to-a-model)).

Why: a property can hold for reasons that have nothing to do with the change, for instance because the situation it describes never arises. Seeing it violated
on the old model shows that it can fail at all, which is the same reason a regression test is seen red before it is green. **Enforced by** the check
`property-failed-first`, as a note. It names the property as its subject, so when there is no earlier model to run it on, the finding is waived with the reason
([a finding is fixed, or waived](#a-finding-is-fixed-or-waived-with-its-reason)).

The same property is backed by a [witness](glossary.md#witness): a second property, linked to it with `witnesses`, that holds and shows the new behaviour can
actually happen. Why: a property about a situation that never arises holds on any model, so it proves nothing until something shows the situation is reachable.
**Enforced by** the check `property-witnessed`, as a note, waived with its reason when a witness makes no sense.

A refactoring, a change to a model that is meant to change nothing it does, is proved instead by comparing the two versions: `naima equivalent` has the verifier
check that the old and new model are equivalent, and carries every earlier result over to the new one, marked as carried
([a refactoring, proved by equivalence](prove-and-close.md#a-refactoring-proved-by-equivalence)). Why: running every property again on a model that behaves
exactly as before only repeats what is known, and the comparison shows that it does behave the same, which the properties alone would not. **Convention**: a
refactoring that cannot be shown equivalent is verified again like any other change.

A model that changes over several landings can be marked [in development](glossary.md#in-development), with an item of type `models`. While it is, the results
of its properties are only information: a run that is out of date is a note, not a problem, and the two checks above ask nothing. It leaves development only
when every property verified on it holds on a current run. Why: work that spans landings would otherwise keep `naima check` failing for a state everyone knows
is temporary, and a model should come back under the rules only once all of its properties have been shown to hold again. **Enforced by** the write hook
`leaves-development-proved`, and the check `model-development`.

Nothing of this is asked while a branch is being prepared, because a branch is in development by nature. It is asked when the branch lands. Why: landing is the
moment a change becomes part of the project, and asking earlier only slows down work that is still being tried. **Enforced by** `naima land`: it refuses a
branch when a property verified on a file the branch changed, or a test suite that reads one, has no current result on the branch, outside models in
development. A proof that can't be made current before landing, such as a suite that runs for days, is left to a long run the owner starts, with
`--stale-proofs "<reason>"`, and the reason stays in the landing commit ([when the rules apply](prove-and-close.md#when-the-rules-apply)).

### A page does not outlive its answer

An unticked clause on an open item shouldn't name a test that has already passed, and an agent's test shouldn't excuse itself because something was held.
**Enforced by** the checks `unticked-clause-names-passed-test` and `test-excuses-itself`, as notes. The excuse phrases they look for are set in the `trackers`
option `excusePhrases`.

### A partial item says what is left

**Enforced by** the check `partial-says-what-is-left`, which requires an item in status `partial` to carry at least one unticked `- [ ]` line on its page.

### A deferred item says why, and what would reopen it

A [deferral](glossary.md#deferral) (`priority=parked`, a bug set to `wontfix` or a todo set to `dropped`) is still an item that someone may want to re-argue
later, so it isn't lost. Say on its page why it is deferred, and set [`reopensWhen`](glossary.md#reopenswhen). `naima view parked` lists every deferral with its
trigger, so people find it before they argue the question again from scratch. **Enforced by** the check `deferred-says-why`, which reports a problem when a
deferred item is left exactly as the unfilled template it was created with.

### Behaviour shipped without proof is marked

A [beta marker](glossary.md#beta-marker) in the code names the item whose passing would prove the behaviour. **Enforced by** the check `beta-markers`, which
fails on a marker that names nothing or that is still there after its proof has passed.

## People and agents

### Don't ask the human if you know the answer

Agents ask a person only for things that are really theirs to give, such as a judgement of how something looks or feels, a decision reserved to the
[owner](glossary.md#owner), a credential or a physical act. **Convention** ([asking the human](../agents/asking-the-human.md)).

### Don't start implementing until the owner says so

A request isn't an instruction to start building. First its item says what "done" means. For a feature, that is its behaviour, its boundaries and how it will be
documented. For a defect, it is its [triage](glossary.md#triage) fields and the gesture that proves the fix. Implementation then waits for the owner's explicit
go, and until that arrives the only work is writing and refining the definition. A requirement that arrives while work is already running goes into the
definition, never into the running work. **Convention**.

### Work handed to a person says why

When an item's proof needs a person (`runBy: human`), the item says in `humanBecause` which of the four reasons applies. **Enforced by** the check
`human-says-why`. `naima queue --human` lists each such item with its reason ([run by](glossary.md#run-by), [human because](glossary.md#human-because)).

### Whoever fixes does not also close

A branch doesn't close its own items on the strength of its own tests. Someone else checks the proof, from the [trunk](glossary.md#trunk), after the merge.
**Enforced by** the write hook `no-closing-own-claims`, which makes `naima close` refuse an item the current branch [claims](glossary.md#claim-file) unless you
pass `--force`, which is meant for whoever owns the evidence. The check `closed-not-claimed` also fails on an archived item that the current branch still
claims, however it got there, so release the claim once the evidence owner has closed the item.

### The owner's chat stays private

The conversation between the [owner](glossary.md#owner) and an agent is private, so nothing from it is copied into the repository verbatim. The agent writes the
report, the description or the note in its own words. The owner's own words are quoted, and a file or screenshot the owner shared becomes an attachment, only
after the owner has explicitly said yes. **Enforced by** `naima attach`, which records on the item whose each file is and the owner's yes, restated
(`--consent`), and refuses a file that has neither `--consent` nor `--own`. The check `attachment-consent` also fails on an attachment a branch adds without
such a record. Paraphrasing the chat in prose is **convention** ([reporting and triage](../agents/reporting-and-triage.md#3-what-a-report-carries)).

### No machine names or private infrastructure in a repository

Nothing a repository holds (code, docs, tracker items, notes, session notes, events, attachments, evidence, commit messages) carries a machine's name or
hostname, an IP address, a URI with a port, a home-directory or user-named local path, a user name, or anything else private about the infrastructure the work
ran on. Evidence is still copied exactly, but with those details replaced by the placeholders `<host>`, `<ip>`, `<path>` and `<user>`, as in `ssh <host> uptime`
or `<path>/run.log`. Redact **before** creating any item, note, session note, event, description or attachment, never after, and remember that a public
repository's tracker is public too.

Why: evidence is copied verbatim on purpose, and a verbatim command or log carries the name of the machine it ran on and the path of the user who ran it. Once
it's committed, it stays in the history of a repository that anyone may be able to read.

**Enforced by** the write hook `private-infrastructure` and by `naima pass`, `naima event` and `naima attach`. Every write of tracker text that the CLI makes is
checked before anything reaches the disk, and it is refused if it adds a machine name, an IP address other than the loopback, a URI with a port on a host other
than the loopback or an example domain, a path under `/Users/`, `/home/` or `C:\Users\`, the user's login name, or a word from the user's private list. Each
finding is listed with its line and the placeholder to write instead. Nothing is rewritten silently, so the author rewrites the text and runs the command again.
A deliberate mention can go through with `--allow-private "<reason>"`, and then the reason is recorded in the item's notes, the session note or the event,
together with the counts by kind but never the values. The private list holds one word per line (`#` starts a comment) and lives in
`$XDG_CONFIG_HOME/naima/private-words`, or else `~/.config/naima/private-words`, or `%APPDATA%\naima\private-words` on Windows. That is outside every
repository, so the names it holds are never committed. What the CLI doesn't write (code, docs, commit messages) is **convention**.

### Git is the agent's job, done safely

The owner never has to learn git. Agents install it when it's missing, start a repository when there isn't one, keep secrets and private data out of it with a
`.gitignore`, and save work in small commits. They never force-push, never rewrite history and never commit a secret. **Enforced by** the check `secrets`, which
looks for a private key with its body, or an AWS, GitHub, Slack, API-secret or Google key, in any project file or attachment. Each of its exceptions carries a
reason and an item, and the list of exceptions only shrinks. `naima attach` also refuses a file that holds a secret. The rest is **convention**
([git, handled for the owner](../agents/git-for-the-owner.md)).

### Long work goes through naima run and naima wait

A command that is expected to take more than a few minutes, or that runs on another machine, is started with `naima run` and a time budget, waited on with
`naima wait`, and cleaned up with `naima run clean`. When it writes stores or temporary data, it also gets a disk budget on what it declares it creates.
Hand-written wait loops (`while` or `until` with `sleep`) and any process lookup by pattern (`pgrep -f`, `pkill -f`) are forbidden.

Why: wait loops that matched their own command line ran for up to 10.5 hours while being shown as work in progress, and a remote disk filled up with stores that
nobody removed. A run with a budget ends by itself, and a wait by record ends when the run does.

This rule ships with Naima, is active for agents in every project, and is acknowledged as "Long work mode on". **Enforced by** the check `wait-loops` on every
tracked shell script, and a session note that records such a wait gets a note. The rest is **convention** ([long work](../agents/long-work.md),
[for people](long-work.md)).

### Long work reports its progress, or says why it cannot and what it reports instead

Work that can last more than a few seconds reports its progress at least every few seconds. It says how much of the total is done, or which stage it is in with
a count, and it estimates the time left whenever the total is known. Where that really is impossible, as with a tool that has no progress interface, the work
says so and gives the reason, and it reports what it can instead: the elapsed time, the stage, and the tool's own log lines. A run started with `naima run`
writes its progress to `$NAIMA_RUN_PROGRESS`, or is started with `--no-progress "<reason>"`. A Naima command that can run long declares how it reports progress,
or why it cannot.

Why: a solver ran for more than 11 hours on each of two properties, with nothing to show whether it was moving, how fast, or when it would end, and a silent run
can't be told apart from one that has hung.

This rule ships with Naima, is active for everyone in every project, and is acknowledged as "Progress mode on". **Enforced by** the check `progress-declared`,
which fails on a command declared long that says neither, and on a `naima run` in a tracked shell script with neither progress nor a reason. It also notes a run
here that stayed silent past its threshold and never wrote progress. The rest is **convention** ([saying how far it is](long-work.md#say-how-far-it-is),
[long work, for agents](../agents/long-work.md)).

### Nothing runs unattended

Naima starts no work on its own, and a project sets none up: no scheduled or nightly runs. Long suites run at the moments that need them, for what a branch
changed when it lands and for everything at the release gate, started by the owner or the coordinator, in view. Between those moments, a long run (the full
suite, or one the project declares, such as the verification of a model) becomes due when something it covers is no longer current, or when it hasn't succeeded
within the time the project allows. `naima hello` and `naima summary` say each due run in one line, and `naima run due` files it as a todo. An agent reports a
due run and asks the owner before starting it.

Why: a run nobody is watching competes with whatever else uses the same machine or host, for the processor, the disk and shared stores, and a model check can
take hours. Only someone who knows what else is going on can pick the moment.

**Convention**: Naima itself never starts a run, and `naima run due` keeps one todo per due run, marked done once the run is current
([when a long run is due](long-work.md#when-a-long-run-is-due)).

### Use the state-of-the-art method for the job

Every action is done with the method made for it, such as a real parser for a language, a library built for the format, or the tool built for the job. An ad-hoc
script, a hack or a regular expression is used only where it really is the right tool, for a flat, regular pattern with nothing nested. It is never used in
place of parsing a structured language like markdown, HTML, JSON, YAML or source code. **Convention**.

Why: a check that read markdown with regular expressions reported hundreds of working links as broken, because it couldn't see anchors declared in HTML. People
switch off or ignore a check that raises false alarms, and then the real defects it exists to find go unseen as well.

### Agents keep the diary

An agent adds an entry to the [diary](glossary.md#diary) on its own, without being asked, when something happens that the owner will later want to read about.
The first case is a decision taken with the [owner](glossary.md#owner) in conversation, written in a sentence or two that says what was decided, why, and which
item it concerns. The second is a change in the direction of the work, such as a plan dropped or a strategy chosen. The third is something notable that happens
outside the tracker, such as an incident, a repository made private or a request from outside the project.

```sh
naima event 2026-10-17 "The owner chose to ship the export before the importer, because the testers need it first (features/csv-export)" --kind diary
```

Routine work gets no entry, because landings, items filed, fixes and test runs are already in the tracker. Neither does anything that a session note, a decision
item or the timeline already records, since `naima diary` shows those by itself. A day holds a few entries at most, and the related turns of one conversation
make a single entry, written once that exchange has settled.

Why: the diary is where the owner reads why the project went where it did. A decision taken in chat and never written down has to be reconstructed later, and a
diary that logs every landing buries the few turns that matter.

This rule ships with Naima, is active for agents in every project, and is acknowledged as "Diary mode on". **Enforced by** the check `diary-entries`, as a note,
on a day with more diary entries than the coordination plugin's `diaryPerDay` option allows (5 by default), and on an entry that only restates a session note of
its day or a decision taken that day. Choosing what deserves an entry is **convention** ([keep a diary](plan-with-epics-milestones-and-gates.md#keep-a-diary)).

### Requirements are elicited at every prompt

Requirements aren't written once at the start of the work. Whenever the owner says something, the agent checks whether it adds a
[requirement](glossary.md#requirement) or changes one. A new one is filed straight away, a changed one is revised on its page, and a change to exactly how
something behaves becomes the next version of its [specification](glossary.md#specification). A vague wish is restated as something a test can decide, and the
agent works out how it will be checked: by a test, by a [property](glossary.md#property) of a model, or, for anything that can be measured, by a
[metric](glossary.md#metric) with a budget. The agent proposes the check and asks the owner only for what is theirs to give, such as the number a budget holds
to.

Why: the owner keeps stating needs in passing, long after the work has started. A requirement heard in chat and never filed is lost, and one filed with no way
to check it can never be met, so people argue about it instead of measuring it.

This rule ships with Naima, is active for agents in every project, and is acknowledged as "Elicitation mode on". **Enforced by** the check
`requirements-proven`, as a note, on a requirement that nothing delivers or proves. The rest is **convention**
([requirements come from every conversation](plan-with-requirements-specs-and-decisions.md#requirements-come-from-every-conversation),
[reporting and triage](../agents/reporting-and-triage.md#elicit-the-requirements-it-carries)).

### Behaviour with states is designed from a model first

Before anyone implements behaviour that has states or concurrency, such as a lifecycle, a protocol, a scheduler, a retry loop or two processes sharing data,
they write a [model](glossary.md#model) of it. The model can be a state machine, kept as data or drawn, an mCRL2 specification, or a state machine encoded in
mCRL2, and any other form that a tool can check is welcome too. Each property the behaviour must have becomes a property item, checked by `naima verify` where a
[verifier](glossary.md#verifier) exists, and the model changes in the same change as the code it describes. A trivial change needs no model. Skipping the model
for behaviour that isn't trivial needs a reason, written on the item as a note.

```sh
naima note features/job-retries "No model: <the reason>"
```

Why: behaviour with states fails in orders of events that nobody thought to test, and a model checker explores every order. A model written after the code only
describes the code, defects included, while one written first is what the code is checked against.

This rule ships with Naima, applies to everyone in every project as a _should_, and is acknowledged as "Model first mode on". **Convention**: nothing checks
that a model exists, and a property item, once there, is held current by the check `property-evidence` ([design with a model](design-with-a-model.md), with a
template of a state machine in mCRL2).

## Branches and worktrees

### One worktree per piece of work

Each piece of work has its own [worktree](glossary.md#worktree) and its own [branch](glossary.md#branch), and writes to that branch and nowhere else.
**Convention** ([work on several branches at once](several-branches.md), [worktree isolation](../agents/worktree-isolation.md)).

### Worktrees and branches are named by one scheme, and every worktree carries a claim

The branch is named `<who>/<what>`, with each part made of lowercase letters, digits, dots and dashes. Its worktree is the folder `<what>` in the worktrees
directory, which is `<main checkout>-worktrees` beside the main checkout unless configured otherwise. Every worktree carries a
[claim file](glossary.md#claim-file), although a worktree that only files items and claims none can make do with a [session note](glossary.md#session-note).
`naima open` creates all three in one step. **Enforced by** the check `worktree-policy`, which fails on a worktree outside the directory or misnamed, on a
branch off the scheme, and on a worktree whose branch has commits the trunk lacks but has no claim (now, or released in those commits) and no session note. A
fresh worktree with no claim yet only gets a note. A gate judges its own tree, so this failure is a problem only for the worktree being checked. Any other
worktree in the same state gets a note naming it, so that one worker's missing claim never blocks another branch's gate. For the coordinator,
`naima check --all-worktrees` reports every worktree's state as a problem. Branches the scheme doesn't cover are listed under the coordination plugin's `exempt`
option. A worktree outside the directory that carries no claim and no session note was not made by Naima, for instance one the project had before Naima was
installed, so the check only notes where Naima puts its own worktrees and asks nothing more of it.

### No shared mutable file

Two sessions never edit the same file to register, announce or log something. Instead, a collection is a directory holding one file per session, named by a
uuid. **Convention** for the project's own files. Naima's claims and [session notes](glossary.md#session-note) are built this way.

### A claim names real items

**Enforced by** the check `claims-resolve`.

### Nobody commits on the trunk while branches are being prepared

**Enforced by** the check `trunk-moved-while-preparing`, as a note. When a branch's claim is marked `naima claim --preparing`, the branch is told every commit
the trunk took that it lacks, and which of those the trunk's reflog records as committed on the trunk directly. The reflog belongs to this clone only, so a
commit made in another clone and then pulled arrives as a fast-forward and isn't named.
[Worktree isolation](../agents/worktree-isolation.md#2-nobody-commits-on-the-trunk-while-branches-are-being-prepared).

### No branch is deleted with work only it holds

**Enforced by** `naima prune --branch`, which deletes a branch and its worktree only when the trunk or an `archive/<branch>` tag holds its commits, and
`--archive` makes that tag first. Before a bulk change of the tracker, where many items are moved, closed or deleted at once, tag the commit it starts from with
`git tag checkpoint/<date>-<what>`. Plain `git branch -D` isn't stopped
([closing a worktree](../agents/closing-a-worktree.md#8-only-then-remove-the-worktree-and-the-branch)).

### Every landing is a marker naming the items it closes

A branch enters the trunk as a [marker](glossary.md#marker). That is a merge commit whose first parent is the trunk and whose second parent is the branch tip,
whose tree is the branch tip's tree, and which has one `Closes: <item id>` trailer for each item it closes. The branch is prepared first, by merging the trunk
into it and running its gates again, so that the trunk is an ancestor of the branch. A branch that isn't up to date is never forced in. Every landing closes at
least one item, so partial work is split: the finished part is closed and the rest becomes a new item. The trunk's first-parent line is the record of landings,
and `M^1..M^2` lists the commits that a marker `M` landed.

The coordinator lands with `naima land <branch>`. By hand, the same commit:

```sh
git merge-base --is-ancestor main <branch> && \
  git merge --no-ff <branch> -m "Land <branch>" -m "Closes: <item id>"
```

A hosting platform's merge button makes the same shape, provided branches are required to be up to date. Naima's commands that act on git (`naima
open`,
`naima land`, `naima prune`) are shortcuts for what a person can do by hand, and `naima check` has the final word. **Enforced by** the check
`landings-are-markers`, as a note. Starting from the first marker on the trunk's first-parent line, it names every commit on that line that isn't a marker and
says why. History before the first marker isn't judged.

One kind of commit may be made directly on the trunk: one that only adds to the tracker data. It may add new files in the data directory, such as a new item, a
diary entry in `events/` or a session note in `passes/`, and it may add lines to an item's `README.md`, as a note does, while the item's `meta.json` stays as it
was. The check accepts such a commit without a note. Filing what the owner says, at the moment it is said, shouldn't need a branch and a landing, and a commit
that only adds can't change or hide anything that has landed. A commit that changes or deletes a file, or that touches `rules/`, `waivers/` or `naima.json`,
still goes through a branch: a status, a rule, a waiver and the lock change what the project holds to, so they arrive as a marker like any other change.

The check names each commit in a note of its own. History on a shared trunk is never rewritten, so a commit it names that the project accepts as it is gets a
waiver, once, with its reason: `naima waive landings-are-markers
<commit> --reason "<why>"`. From then on `naima check` lists the waiver instead of the note.
Blocking such a commit with a git hook is [planned](../planned.md#blocking-a-landing-that-is-not-a-marker), as something a project could opt into but never the
default ([closing a worktree](../agents/closing-a-worktree.md#7-hand-it-over)).

### No locks: the coordinator is the single writer

Naima has no locks. Only the [coordinator](../agents/coordinator-and-workers.md) lands branches on the trunk, pushes it, publishes the site and makes releases,
and it does all of that from the trunk. Workers only prepare work, on their own branches. When it matters, the [owner](glossary.md#owner) decides what lands and
when. **Convention** ([several branches](several-branches.md#one-writer-no-locks)).

Why: with a single writer nothing is contended, so a lock would only add state that can go stale. It also means that what is published is always what the trunk
holds, never a branch that hasn't landed.

### Workers post their current step

A worker says what it is doing while it works, not only when it finishes. At every change of step, and at least every few minutes during long work, it runs
`naima claim --step "<what I am doing now>"`, and it runs long commands through `naima run` so that their progress shows too. The coordinator reads
`naima claims` at least every few minutes while workers run, and says what each one is doing when the owner asks. A claim with no step and no commit newer than
the coordination plugin's `silentAfter` option (15 minutes by default) is marked "silent for N min — possibly stuck". The coordinator checks that worker's run
and worktree, then reports it as possibly stuck.

```sh
naima claim --step "running the gates"
```

Why: until it reports, a worker that only reports at the end can't be told apart from one that is stuck. A worker eight minutes into the full test suite looked
hung, because nothing it did was visible.

This rule ships with Naima and is active for agents in every project, with no acknowledgement phrase. Flagging a silent claim is done by `naima claims` and
`naima summary`; posting the step and reading the claims is **convention**.

### Claims are released, and a session note written, before merging

**Convention**: [closing a worktree](../agents/closing-a-worktree.md).

### Every change of behaviour carries a change note

A repository that has a `changes/config.json` lists there the paths whose change alters behaviour. That can be the project itself, or a product the project
holds as a submodule, as Naima's workshop holds Naima. Behaviour is meant widely: commands, options and APIs, how the software is used, and the workflows,
including the rules agents acknowledge. A branch that changes one of those paths adds a change note on the same branch, one Markdown file in that repository's
`changes/` folder, saying what kind of change it is, what it touches and what a user has to do ([the format](../../changes/README.md)). Release notes are
assembled from the notes with `naima changes`, and an update of Naima shows them before it is applied ([update Naima](update-naima.md)).

A change nobody can see, such as a refactor or a new test, needs no note, but the coordinator says so when landing it:
`naima land <branch>
--no-change-note "<reason>"`, and the marker keeps the reason in a `No-change-note:` trailer. **Enforced by** `naima land`, which refuses a
branch that changes those paths without a note, and by the check `change-notes`, which notes it on the branch beforehand and fails on a file in `changes/` that
isn't a valid note.

## Naima itself

### Update deliberately, as one commit

The [lock](glossary.md#lock) moves only with `naima update` or `naima
rollback`, each as one reviewable commit, and only after the owner has said yes. A session
starts with `naima hello`, which checks for a newer Naima as the `updates` setting in `naima.json` says. **Enforced by** [alignment](glossary.md#alignment),
which never pulls and refuses a changed [source](glossary.md#source) until `naima update
--accept-source` is run ([update Naima](update-naima.md)).

### Every session starts with naima hello

An agent runs `naima hello` at the start of every session and passes on what it says, so the owner always knows which Naima is active and whether a newer one
exists. A skill is loaded only when the agent judges it relevant, so the instruction is also in the pointer line of the project's entry file, and for an agent
tool that can run a command when a session starts, a hook runs it
([running naima hello at every session start](install.md#running-naima-hello-at-every-session-start)). **Enforced by** the check `session-start`, as a note, and
by `naima init` and `naima update`, which write the line and the hooks.

### Naima is tied to no agent tool or model

Naima works with any agent that can run a command, on any model. Its code, its skill and its documentation name no agent tool or model, except in a tool's
adapter and in an example marked as one tool's. A project that uses a particular tool says so in its own `naima.json` (`agents`). The reason: a project chooses
its tools, and what Naima brings is the method and the records, not a vendor. **Convention** for a project; in Naima's own repository a test holds it.

### A tracker never mixes formats

**Enforced by** the check `one-format`. After a teammate has updated, merge the trunk and run `naima update`
([update Naima](update-naima.md#on-a-branch-opened-before-the-update)).

### Third-party code runs only pinned

A plugin from outside Naima runs only from a pinned file hash or commit. **Enforced by** the loader, which refuses a file that has changed
([add a plugin someone gave you](add-a-plugin.md)).

## Documentation

### Features are documented as part of their implementation

A feature isn't done until its documentation is in the same change, and "documented" means documented for people and for agents alike. People need a page they
can follow without reading the code, and agents need what they require to act on the feature. A feature item in status `shipped` names its pages in `docs`.
**Enforced by** the checks of the `docs` plugin:

| Check                 | Fails when                                                                                                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features-documented` | a shipped feature names no page in `docs`, or names a file or heading that does not exist                                                                                                                                                                                                     |
| `links-resolve`       | a relative link in any markdown file the project tracks points at nothing: a file that does not exist, or an anchor that no heading and no HTML `id` declares — read by a CommonMark parser, so a link in a list, a quote, a table or a reference definition counts, and one in code does not |
| `documented`          | a loaded plugin's command, type, field, check or [gate](glossary.md#gate) carries no documentation in its manifest                                                                                                                                                                            |
| `reference-current`   | with the `docs` plugin's `reference` option set, the reference file differs from what `naima docs` generates                                                                                                                                                                                  |

How to set `docs` on a feature: [file a feature](file-a-feature.md#when-it-ships).

## A project's own rules

A project's own rules, the ones that only it follows, aren't pages of Naima's documentation. They are data in the project's own `naima-tracker/naima-data/`.
`naima rules` lists them, and `naima guide` shows the ones meant for agents first ([write a project rule](write-a-project-rule.md),
[read the project's rules](../agents/read-the-project-rules.md)).
