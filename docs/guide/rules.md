# Rules

The rules every project that uses Naima holds to, for people and
[agents](glossary.md#agent) alike. This is the only place they are written:
the [flows](glossary.md#flow), the skill and every other page link here instead of repeating
them.

Each rule is marked:

- **enforced by** a [check](glossary.md#check) of `naima check`, a
  [write hook](glossary.md#write-hook) or a command that refuses — Naima stops
  you when it is broken;
- **convention** — nothing stops you; the project keeps it by habit, and the
  linked page says how.

Every check, with how it decides: [reference](../reference/reference.md).
Rules that apply only to developing Naima itself are in Naima's own
`AGENTS.md`, not here; [a project's own rules](#a-projects-own-rules) are
data in its tracker.

**A rule's reason is not the same as documentation's history.** "Documentation
states what is, never how it came to be" is about product pages: the guide,
the reference, a feature's own page — none of them tell the story of why a
decision was made. A rule is different on purpose: every rule on this page
carries its reason, because the reason is part of what the rule *is* — it is
how you judge whether the rule still applies when the situation changes. So a
rule's reason stays here, on the rule; it is never repeated as history on a
product page.

## The tracker

### Change the tracker only through the CLI

Items are created, changed, linked and closed with `naima` commands, never by
editing `meta.json` by hand. An item's page, `README.md`, is written with
`naima describe` (the description) and `naima note` (a dated, attributed,
append-only note); a person may also write it as a file.
**Enforced by** the checks `readable`, `identity`, `fields` and `links`,
which fail on what a hand edit typically breaks, and by the check counterpart
of every write hook that protects a state — `property-evidence` for
`holds-only-by-verify` and `property-reopens-when-changed`,
`closed-not-claimed` for `no-closing-own-claims`, `epics` for `epic-status` — so a hand edit that a
command would have refused fails `naima check`. The hooks that guard a move
rather than a state (`status-moves`, `notes-append-only`) and the ones that
only fill in a value (`triage-stamps-its-date`, `planning-stamps`) have none;
the rest is convention.

### Run `naima check` before every commit

**Convention**, kept by the project's own CI when it runs `naima check`.

### Write it down before fixing it

A defect, a task or a request becomes an [item](glossary.md#item) first,
then gets worked on. A fix with no trace is diagnosed from scratch next time.
**Convention**: [file a bug](file-a-bug.md).

### Triage what you touch

An item you open, report or fix leaves with [impact](glossary.md#impact),
[priority](glossary.md#priority) and [confidence](glossary.md#confidence) set.
**Convention**; `naima triage` shows coverage and `naima triage missing`
what lacks [effort](glossary.md#effort): [triage](triage.md).

### Effort is never guessed

Only someone who has looked at the work to be done sets `effort`. **Convention**: no
tool infers it (`naima triage derive` never touches it).

### Fixed, resolved and closed are three states

[Fixed](glossary.md#fixed) (the change exists), [resolved](glossary.md#resolved)
(fixed and proven) and [closed](glossary.md#closed) (resolved and archived)
are never confused or added into one number. **Enforced by** `naima close`,
which refuses anything not resolved, and the checks `closed-carries-proof`
(every archived item carries a passed [proof](glossary.md#proof)) and `proven-but-open` (a note:
an open item whose proof passed, ready to close).

### Every fix names the gesture that proves it

A fixed item is [verified by](glossary.md#verifies) a
[test item](glossary.md#test-item) or a [property](glossary.md#property).
**Enforced by** the check `fix-names-its-gesture`, as a note: it reports, and
never fails: [prove and close](prove-and-close.md).

### A proof is current, and evidence against it wins

An item whose verifying item [refutes](glossary.md#refutes) it, or whose
proof `naima check` reports as no longer current (a property run on a model,
a file the model includes, or a tool version that has changed since), cannot
be closed. **Enforced by** `naima close` and the check
`property-evidence`; a property becomes `holds` only through `naima verify`
(the write hook `holds-only-by-verify`).

### Evidence travels with the claim

"It works" without a number, a log line or an attachment is not a proof.
[Evidence](glossary.md#evidence) goes in the item's `attachments/`, through
`naima attach`. **Convention**, except for properties, whose runs
`naima verify` attaches.

### Evidence is ranked, and no number stands without its comparison

Strongest first: the owner performing the gesture; a screenshot, a log line or
a number; the live state read by tooling; a before-and-after comparison; "the
code looks right", which proves nothing. A test names its rank in
`evidenceKind`. A number proves something only beside the value it is
compared with. **Enforced by** the check `inspection-proves-nothing`, as a
note; the rest is **convention**: [prove and close](prove-and-close.md#3-perform-it-keep-the-evidence).

### A regression test is seen red before it is green

A test that verifies a bug was run on the code before the fix and failed,
then on the fix and passed; `redSeen` records the day it failed.
**Enforced by** the check `regression-test-saw-red`, as a note.

### A page does not outlive its answer

An open item's unticked clause does not name a test that has passed, and an
agent's test does not excuse itself because something was held.
**Enforced by** the checks `unticked-clause-names-passed-test` and
`test-excuses-itself`, as notes; the excuse phrases are the `trackers` option
`excusePhrases`.

### A partial item says what is left

**Enforced by** the check `partial-says-what-is-left`: an item in status
`partial` carries at least one unticked `- [ ]` line on its page.

### A deferred item says why, and what would reopen it

A [deferral](glossary.md#deferral) — `priority=parked`, or a bug `wontfix`
or a todo `dropped` — is still an item someone may re-argue later, not a
loss: say why it is deferred on its page, and set
[`reopensWhen`](glossary.md#reopenswhen). `naima view parked` lists every
one with its trigger, so a deferral is found before it is re-argued from
scratch. **Enforced by** the check `deferred-says-why`: a deferred item left
exactly as the unfilled template it was created with is a problem.

### Behaviour shipped without proof is marked

A [beta marker](glossary.md#beta-marker) in the code names the item whose
passing would prove it. **Enforced by** the check `beta-markers`: a marker
naming nothing, or outliving its proof, fails.

## People and agents

### Don't ask the human if you know the answer

A person is asked only for what is genuinely theirs: a judgement of how
something looks or feels, a decision reserved to the
[owner](glossary.md#owner), a credential, a physical act. **Convention**:
[asking the human](../agents/asking-the-human.md).

### Don't start implementing until the owner says so

A request is not a work order. First its item says what "done" is: for a
feature, its behaviour, its boundaries and how it is documented; for a defect,
its [triage](glossary.md#triage) fields and the gesture that proves the fix. Then implementation
waits for the owner's explicit go; until then the only work is writing and
refining that definition. A requirement that arrives while work is running
goes into the definition, never into the running work. **Convention**.

### Work handed to a person says why

An item whose proof needs a person (`runBy: human`) says which of the four
reasons it is in `humanBecause`. **Enforced by** the check `human-says-why`;
`naima queue --human` lists each with its reason
([run by](glossary.md#run-by), [human because](glossary.md#human-because)).

### Whoever fixes does not also close

A branch does not close its own items on the strength of its own tests:
someone else checks the proof, from the [trunk](glossary.md#trunk), after the
merge. **Enforced by** the write hook `no-closing-own-claims`: `naima close`
refuses an item the current branch [claims](glossary.md#claim-file), unless
`--force`, which is for the one who owns the evidence; and the check
`closed-not-claimed` fails on an archived item the current branch still
claims, however it got there — release the claim once the evidence owner has
closed it.

### The owner's chat stays private

The conversation between the [owner](glossary.md#owner) and an agent is
private. Nothing from it is copied into the repository verbatim: the agent
writes the report, the description or the note in its own words. The owner's
own words are quoted, and a file or screenshot the owner shared becomes an
attachment, only after the owner's explicit yes. **Enforced by** `naima attach`,
which records on the item whose each file is and the owner's yes, restated
(`--consent`), and refuses a file without one of `--consent` and `--own`; and
the check `attachment-consent`, which fails on an attachment a branch adds
with no such record. Paraphrasing the chat in prose is **convention**:
[reporting and triage](../agents/reporting-and-triage.md#3-what-a-report-carries).

### Git is the agent's job, done safely

The owner never has to learn git. Agents install it when it is missing,
start a repository when there is none, keep secrets and private data out of
it with a `.gitignore`, and save work in small commits; they never
force-push, never rewrite history, and never commit a secret.
**Enforced by** the check `secrets` for secrets — a private key with its
body, or an AWS, GitHub, Slack, API-secret or Google key, in any project file
or attachment — whose exceptions each carry a reason and an item, and only
shrink; and by `naima attach`, which refuses a file holding one. The rest is
**convention**: [git, handled for the owner](../agents/git-for-the-owner.md).

### Long work goes through naima run and naima wait

A command expected to outlast a few minutes, or one run on another machine, is
started with `naima run` and a time budget — with a disk budget on what it
declares it creates, when it writes stores or temporary data — waited on with
`naima wait`, and cleaned with `naima run clean`. A hand-written wait loop
(`while` or `until` with `sleep`) and any process lookup by pattern (`pgrep
-f`, `pkill -f`) are forbidden. Why: wait loops matching their own command
line ran for up to 10.5 hours while shown as work in progress, and a remote
disk filled with stores nobody removed; a run with a budget ends itself, and a
wait by record ends when the run does. Shipped with Naima, active for agents
in every project, acknowledged as "Long work mode on". **Enforced by** the
check `wait-loops`, on every tracked shell script (a session note that
records such a wait is noted); the rest is **convention**:
[long work](../agents/long-work.md), [for people](long-work.md).

### Long work reports its progress, or says why it cannot and what it reports instead

Work that can last more than a few seconds reports its progress at least
every few seconds: how much is done of the total, or the stage it is in with
a count, and an estimate of the time left whenever the total is known. Where
that is truly impossible — a tool with no progress interface — the work
declares so, with the reason, and reports what it can: the elapsed time, the
stage, and the tool's own log lines. A run started with `naima run` writes
its progress to `$NAIMA_RUN_PROGRESS`, or is started with `--no-progress
"<reason>"`; a Naima command that can run long declares how it reports, or
why it cannot. Why: a solver ran for more than 11 hours on each of two
properties with nothing to show whether it was moving, how fast, or when it
would end; a silent run cannot be told apart from a hung one. Shipped with
Naima, active for everyone in every project, acknowledged as "Progress mode
on". **Enforced by** the check `progress-declared`: a command declared long
that says neither, a `naima run` in a tracked shell script with neither
progress nor a reason, and (noted) a run here silent past its threshold that
never wrote progress; the rest is **convention**:
[saying how far it is](long-work.md#say-how-far-it-is),
[long work, for agents](../agents/long-work.md).

### Use the state-of-the-art method for the job

Every action is done with the method made for it: a real parser for a
language, a library built for the format, the tool built for the job. An
ad-hoc script, a hack or a regular expression is used only where it is
genuinely the right tool — a flat, regular pattern with nothing nested — and
never in place of parsing a structured language: markdown, HTML, JSON, YAML,
source code. **Convention**.

Why: a check that read markdown with regular expressions reported working
links as broken by the hundred, because it could not see anchors declared in
HTML; a check that cries wolf is switched off or ignored, and the real
defects it exists to find go unseen with it.

## Branches and worktrees

### One worktree per piece of work

Each piece of work has its own [worktree](glossary.md#worktree) and its own
[branch](glossary.md#branch), and writes to that branch and nowhere else.
**Convention**: [work on several branches at once](several-branches.md),
[worktree isolation](../agents/worktree-isolation.md).

### Worktrees and branches are named by one scheme, and every worktree carries a claim

The branch is `<who>/<what>`, each part lowercase letters, digits, dots and
dashes; its worktree is the folder `<what>` of the worktrees directory
(`<main checkout>-worktrees` beside the main checkout, unless configured).
Every worktree carries a [claim file](glossary.md#claim-file), or, for one
that only files items and claims none, a [session note](glossary.md#session-note)
is enough. `naima open` makes the three in one step. **Enforced by** the
check `worktree-policy`: a worktree outside the directory or misnamed, a
branch off the scheme, and a worktree whose branch has commits the trunk
lacks with no claim (now, or released in those commits) and no session note
fail; a fresh worktree with no claim yet is a note. A gate judges its own
tree: this failure is a problem only for the worktree being checked; for any
other worktree in the same state it is a note, naming it, so one worker's
missing claim never blocks another branch's gate. `naima check
--all-worktrees` reports every worktree's state as a problem, for the
coordinator. Branches the scheme does not cover are listed under the
coordination plugin's `exempt` option.

### No shared mutable file

Two sessions never edit one file to register, announce or log something;
a collection is a directory of one file per session, named by a uuid.
**Convention** for the project's own files; Naima's claims and [session notes](glossary.md#session-note)
are built this way.

### A claim names real items

**Enforced by** the check `claims-resolve`.

### Nobody commits on the trunk while branches are being prepared

**Enforced by** the check `trunk-moved-while-preparing`, as a note: a branch
whose claim is marked `naima claim --preparing` is told every commit the
trunk took that it lacks, and which of them the trunk's reflog records as
committed on the trunk directly. The reflog is this clone's own: a commit
made in another clone and pulled arrives as a fast-forward and is not named.
[Worktree isolation](../agents/worktree-isolation.md#2-nobody-commits-on-the-trunk-while-branches-are-being-prepared).

### No branch is deleted with work only it holds

**Enforced by** `naima prune --branch`, which deletes a branch and its
worktree only when the trunk or an `archive/<branch>` tag holds its commits;
`--archive` makes the tag first. Before a bulk change of the tracker — many
items moved, closed or deleted at once — tag the commit it starts from,
`git tag checkpoint/<date>-<what>`. Plain `git branch -D` is not stopped:
[closing a worktree](../agents/closing-a-worktree.md#8-only-then-remove-the-worktree-and-the-branch).

### Every landing is a marker naming the items it closes

A branch enters the trunk as a [marker](glossary.md#marker): a merge
commit whose first parent is the trunk, whose second is the branch tip,
whose tree is the branch tip's, with one `Closes: <item id>` trailer per
item it closes. The branch is prepared first: the trunk merged into it and
its gates run again, so the trunk is an ancestor of the branch. A branch
not up to date is never forced in. Every landing closes at least one item:
partial work is split, the done part closed, the rest a new item. The
trunk's first-parent line is the record of landings, and `M^1..M^2` lists
the commits a marker `M` landed.

The coordinator lands with `naima land <branch>`. By hand, the same commit:

```sh
git merge-base --is-ancestor main <branch> && \
  git merge --no-ff <branch> -m "Land <branch>" -m "Closes: <item id>"
```

A hosting platform's merge button, with branches required to be up to
date, makes the same shape. Naima's commands that act on git (`naima
open`, `naima land`, `naima prune`) are shortcuts for what a person can do
by hand; `naima check` is the authority. **Enforced by** the check
`landings-are-markers`, as a note: from the first marker on the trunk's
first-parent line, every commit on that line that is not a marker is named,
with why. History before the first marker is not judged. Blocking such a
commit with a git hook is [planned](../planned.md#blocking-a-landing-that-is-not-a-marker),
for a project to opt into, never the default:
[closing a worktree](../agents/closing-a-worktree.md#7-hand-it-over).

### No locks: the coordinator is the single writer

Naima has no locks. Only the [coordinator](../agents/coordinator-and-workers.md)
lands branches on the trunk, pushes it, publishes the site and makes
releases, and does so from the trunk; workers only prepare, on their own
branches. The [owner](glossary.md#owner) decides what lands and when, when it
matters.
**Convention**: [several branches](several-branches.md#one-writer-no-locks).

Why: with one writer, nothing is contended, so a lock would only add state
that can go stale; and what is published is always what the trunk holds,
never a branch that has not landed.

### Claims are released, and a session note written, before merging

**Convention**: [closing a worktree](../agents/closing-a-worktree.md).

## Naima itself

### Update deliberately, as one commit

The [lock](glossary.md#lock) moves only with `naima update`, as one
reviewable commit; at the start of a session, `naima update --check`.
**Enforced by** [alignment](glossary.md#alignment), which never pulls and
refuses a changed [source](glossary.md#source) until `naima update
--accept-source`: [update Naima](update-naima.md).

### A tracker never mixes formats

**Enforced by** the check `one-format`: after a teammate's update, merge the
trunk and run `naima update` ([update Naima](update-naima.md#on-a-branch-opened-before-the-update)).

### Third-party code runs only pinned

A plugin from outside Naima runs only from a pinned file hash or commit.
**Enforced by** the loader, which refuses a changed file:
[add a plugin someone gave you](add-a-plugin.md).

## Documentation

### Features are documented as part of their implementation

A feature is not done until its documentation is in the same change, and
"documented" means **both** for people and for agents: a page a person can
follow without reading the code, and what an agent needs to act on it. A
feature item in status `shipped` names its pages in `docs`.
**Enforced by** the checks of the `docs` plugin:

| Check | Fails when |
|---|---|
| `features-documented` | a shipped feature names no page in `docs`, or names a file or heading that does not exist |
| `links-resolve` | a relative link in any markdown file the project tracks points at nothing: a file that does not exist, or an anchor that no heading and no HTML `id` declares — read by a CommonMark parser, so a link in a list, a quote, a table or a reference definition counts, and one in code does not |
| `documented` | a loaded plugin's command, type, field, check or [gate](glossary.md#gate) carries no documentation in its manifest |
| `reference-current` | with the `docs` plugin's `reference` option set, the reference file differs from what `naima docs` generates |

How to set `docs` on a feature: [file a feature](file-a-feature.md#when-it-ships).

## A project's own rules

A project's own rules — the ones only it holds to — are not pages of Naima's
documentation: they are data in its own `naima-tracker/naima-data/`.
`naima rules` lists them, and `naima guide` shows those for agents first:
[write a project rule](write-a-project-rule.md),
[read the project's rules](../agents/read-the-project-rules.md).
